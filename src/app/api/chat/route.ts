import { NextRequest } from 'next/server'
import { createAnthropic } from '@ai-sdk/anthropic'
import { tool, generateText, stepCountIs } from 'ai'
import { z } from 'zod'
import { createServerClient } from '@/lib/supabase'
import { embed } from '@/lib/embeddings'
import { searchWeb } from '@/lib/exa'
import { getOrCreateSessionId, sessionCookieOptions } from '@/lib/session'
import type { ChunkSearchResult, MemorySearchResult, Citation } from '@/lib/types'

export const runtime = 'nodejs'
export const maxDuration = 120

function createAnthropicClient() {
  return createAnthropic({
    apiKey: process.env.AI_GATEWAY_API_KEY!,
  })
}

function buildSystemPrompt(chunks: ChunkSearchResult[], memories: MemorySearchResult[]): string {
  let prompt = `You are a personal knowledge assistant. Answer questions based on the user's uploaded documents. If documents don't cover the topic, use the search_web tool. Always cite specific documents as [filename p.N] when quoting or paraphrasing.`

  if (memories.length > 0) {
    prompt += `\n\n## What you remember about this user:\n${memories.map(m => `- ${m.content}`).join('\n')}`
  }

  if (chunks.length > 0) {
    prompt += `\n\n## Relevant context from their documents:\n${chunks.map(c => `[${c.filename} p.${c.page_number}] ${c.content}`).join('\n\n')}`
  }

  return prompt
}

async function extractMemories(
  supabase: ReturnType<typeof createServerClient>,
  sessionId: string,
  conversationId: string | null,
  userMessage: string,
  assistantResponse: string,
) {
  try {
    const { generateObject } = await import('ai')
    const anthropic = createAnthropicClient()

    const { object } = await generateObject({
      model: anthropic('claude-haiku-4-5-20251001'),
      schema: z.object({
        facts: z.array(z.object({
          content: z.string(),
          confidence: z.number().min(0).max(1),
        })),
      }),
      prompt: `Extract durable facts about the user from this conversation. Only high-confidence facts (>0.7) that are useful in future conversations.

User: ${userMessage}
Assistant: ${assistantResponse}

Output facts or empty array if nothing durable.`,
    })

    const highConf = object.facts.filter(f => f.confidence > 0.7)
    for (const fact of highConf) {
      const emb = await embed(fact.content)
      await supabase.from('memories').insert({
        session_id: sessionId,
        content: fact.content,
        embedding: emb,
        source_conversation_id: conversationId,
        confidence: fact.confidence,
      })
    }
  } catch (e) {
    console.error('Memory extraction failed:', e)
  }
}

export async function POST(req: NextRequest) {
  const { message, conversation_id } = await req.json()
  const sessionId = await getOrCreateSessionId()
  const supabase = createServerClient()

  let conversationId: string | null = conversation_id ?? null
  let history: { role: 'user' | 'assistant'; content: string }[] = []

  if (conversationId) {
    const { data: conv } = await supabase
      .from('conversations')
      .select('messages')
      .eq('id', conversationId)
      .eq('session_id', sessionId)
      .single()
    history = (conv?.messages as typeof history) ?? []
  }

  const queryEmbedding = await embed(message)

  const [docResult, memResult] = await Promise.all([
    supabase.rpc('match_chunks', {
      query_embedding: queryEmbedding,
      match_threshold: 0.5,
      match_count: 5,
      p_session_id: sessionId,
    }),
    supabase.rpc('match_memories', {
      query_embedding: queryEmbedding,
      match_threshold: 0.6,
      match_count: 3,
      p_session_id: sessionId,
    }),
  ])

  const chunks: ChunkSearchResult[] = (docResult.data as ChunkSearchResult[]) ?? []
  const memories: MemorySearchResult[] = (memResult.data as MemorySearchResult[]) ?? []
  const citationsMap = new Map<string, Citation>()
  const anthropic = createAnthropicClient()

  // Send SSE helper — defined before stream so closures work
  let sseController: ReadableStreamDefaultController<Uint8Array> | null = null
  const encoder = new TextEncoder()
  function send(event: Record<string, unknown>) {
    if (sseController) {
      sseController.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`))
    }
  }

  const tools = {
    search_documents: tool({
      description: "Search the user's uploaded documents for relevant information",
      inputSchema: z.object({ query: z.string() }),
      execute: async (input: { query: string }) => {
        const qEmb = await embed(input.query)
        const { data } = await supabase.rpc('match_chunks', {
          query_embedding: qEmb,
          match_threshold: 0.4,
          match_count: 5,
          p_session_id: sessionId,
        })
        const results = (data as ChunkSearchResult[]) ?? []
        results.forEach(r => {
          citationsMap.set(r.id, {
            document_id: r.document_id,
            filename: r.filename,
            page_number: r.page_number,
            chunk_id: r.id,
          })
        })
        return results.map(r => `[${r.filename} p.${r.page_number}] ${r.content}`).join('\n\n')
      },
    }),
    search_web: tool({
      description: 'Search the web when document context is insufficient',
      inputSchema: z.object({ query: z.string() }),
      execute: async (input: { query: string }) => {
        const results = await searchWeb(input.query)
        return results.map(r => `[${r.title}](${r.url})\n${r.snippet}`).join('\n\n')
      },
    }),
    save_memory: tool({
      description: 'Save an important fact about the user for future conversations',
      inputSchema: z.object({ fact: z.string() }),
      execute: async (input: { fact: string }) => {
        const emb = await embed(input.fact)
        await supabase.from('memories').insert({
          session_id: sessionId,
          content: input.fact,
          embedding: emb,
          source_conversation_id: conversationId,
          confidence: 0.9,
        })
        return `Saved memory: "${input.fact}"`
      },
    }),
  }

  const messages = [
    ...history,
    { role: 'user' as const, content: message },
  ]

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      sseController = controller

      try {
        if (memories.length > 0) {
          send({ type: 'memories_used', memories: memories.map(m => ({ content: m.content, confidence: m.confidence })) })
        }

        let fullText = ''

        const result = await generateText({
          model: anthropic('claude-sonnet-4-6'),
          system: buildSystemPrompt(chunks, memories),
          messages,
          tools,
          stopWhen: stepCountIs(6),
          experimental_onToolCallStart: (event) => {
            send({ type: 'tool_start', name: String(event.toolCall.toolName) })
          },
          experimental_onToolCallFinish: (event) => {
            send({ type: 'tool_done', name: String(event.toolCall.toolName) })
          },
        })

        fullText = result.text
        // Send text in chunks to simulate streaming
        const words = fullText.split(' ')
        for (let i = 0; i < words.length; i += 5) {
          send({ type: 'text', content: words.slice(i, i + 5).join(' ') + (i + 5 < words.length ? ' ' : '') })
        }

        if (citationsMap.size > 0) {
          send({ type: 'citations', citations: Array.from(citationsMap.values()) })
        }

        // Save conversation
        const updatedHistory = [
          ...history,
          { role: 'user', content: message },
          { role: 'assistant', content: fullText },
        ]

        if (conversationId) {
          await supabase.from('conversations')
            .update({ messages: updatedHistory, updated_at: new Date().toISOString() })
            .eq('id', conversationId)
        } else {
          const { data: newConv } = await supabase.from('conversations')
            .insert({ session_id: sessionId, messages: updatedHistory })
            .select()
            .single()
          conversationId = newConv?.id ?? null
          if (conversationId) send({ type: 'conversation_id', id: conversationId })
        }

        extractMemories(supabase, sessionId, conversationId, message, fullText).catch(console.error)

        send({ type: 'done' })
      } catch (err) {
        send({ type: 'error', message: String(err) })
      } finally {
        controller.close()
        sseController = null
      }
    },
  })

  const opts = sessionCookieOptions()
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Set-Cookie': `${opts.name}=${sessionId}; HttpOnly; SameSite=Lax; Max-Age=${opts.maxAge}; Path=/`,
    },
  })
}
