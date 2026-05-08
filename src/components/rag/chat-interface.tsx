'use client'
import { useState, useRef, useEffect } from 'react'
import { Send } from 'lucide-react'
import { ToolCallIndicator } from './tool-call-indicator'
import { MemoryViewer } from './memory-viewer'
import type { Citation } from '@/lib/types'

interface Message {
  role: 'user' | 'assistant'
  content: string
  citations?: Citation[]
  memories?: { content: string; confidence: number }[]
}

interface ChatInterfaceProps {
  onCitationClick: (citation: Citation) => void
  onConversationIdChange?: (id: string) => void
}

// Suggested starter questions shown in the empty state
const EXAMPLE_SUGGESTIONS = [
  'Summarize the main points of the uploaded documents',
  'What are the key findings?',
  'Explain the methodology used',
]

export function ChatInterface({ onCitationClick, onConversationIdChange }: ChatInterfaceProps) {
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const [conversationId, setConversationId] = useState<string | null>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage(text?: string) {
    const userText = (text ?? input).trim()
    if (!userText || streaming) return
    setInput('')
    setStreaming(true)
    setActiveTool(null)

    const assistantIdx = messages.length + 1
    setMessages(prev => [
      ...prev,
      { role: 'user', content: userText },
      { role: 'assistant', content: '' },
    ])

    let buffer = ''
    let currentCitations: Citation[] = []
    let currentMemories: { content: string; confidence: number }[] = []

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: userText, conversation_id: conversationId }),
      })

      if (!res.ok || !res.body) throw new Error('Request failed')

      const reader = res.body.getReader()
      const decoder = new TextDecoder()

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          try {
            const event = JSON.parse(line.slice(6))
            if (event.type === 'tool_start') {
              setActiveTool(event.name)
            } else if (event.type === 'tool_done') {
              setActiveTool(null)
            } else if (event.type === 'text') {
              buffer += event.content
              setMessages(prev => {
                const copy = [...prev]
                if (copy[assistantIdx]) copy[assistantIdx] = { ...copy[assistantIdx], content: buffer }
                return copy
              })
            } else if (event.type === 'citations') {
              currentCitations = event.citations
            } else if (event.type === 'memories_used') {
              currentMemories = event.memories
            } else if (event.type === 'conversation_id') {
              const newId = event.id
              setConversationId(newId)
              onConversationIdChange?.(newId)
            } else if (event.type === 'done') {
              setMessages(prev => {
                const copy = [...prev]
                if (copy[assistantIdx]) {
                  copy[assistantIdx] = {
                    ...copy[assistantIdx],
                    citations: currentCitations,
                    memories: currentMemories,
                  }
                }
                return copy
              })
            }
          } catch { /* ignore parse errors */ }
        }
      }
    } catch {
      setMessages(prev => {
        const copy = [...prev]
        if (copy[assistantIdx]) copy[assistantIdx] = { ...copy[assistantIdx], content: 'Error: please try again.' }
        return copy
      })
    } finally {
      setStreaming(false)
      setActiveTool(null)
    }
  }

  function renderContent(content: string, citations: Citation[] = []) {
    if (citations.length === 0) return <span className="whitespace-pre-wrap">{content}</span>
    const parts = content.split(/(\[[^\]]+\s+p\.\d+\])/g)
    return (
      <span className="whitespace-pre-wrap">
        {parts.map((part, i) => {
          const m = part.match(/^\[(.+?)\s+p\.(\d+)\]$/)
          if (m) {
            const citation = citations.find(c => c.filename === m[1] && c.page_number === parseInt(m[2]))
            if (citation) {
              return (
                <button
                  key={i}
                  onClick={() => onCitationClick(citation)}
                  className="text-blue-400 hover:text-blue-300 underline underline-offset-2 text-xs font-mono cursor-pointer"
                >
                  {part}
                </button>
              )
            }
          }
          return <span key={i}>{part}</span>
        })}
      </span>
    )
  }

  // True when the last assistant message is still empty — skeleton bubble is showing.
  // While the skeleton is visible we suppress the ToolCallIndicator and typing indicator
  // to avoid showing two simultaneous "loading" signals.
  const hasSkeletonBubble =
    streaming &&
    messages.length > 0 &&
    messages[messages.length - 1]?.role === 'assistant' &&
    messages[messages.length - 1]?.content === '';

  return (
    <div className="flex flex-col h-full">
      {/* Messages area — aria-live so screen readers announce new messages */}
      <div
        className="flex-1 overflow-auto p-4 space-y-4 min-h-0"
        aria-live="polite"
        aria-label="Conversation messages"
      >
        {messages.length === 0 && (
          /* Empty state: centered card with suggested questions */
          <div className="flex items-center justify-center h-full">
            <div className="max-w-sm w-full rounded-2xl border bg-muted/20 p-6 space-y-4">
              <div className="text-center">
                <p className="font-semibold text-foreground text-base">
                  Ask questions about your documents
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Upload a PDF, then try one of these to get started:
                </p>
              </div>
              <ul className="space-y-2">
                {EXAMPLE_SUGGESTIONS.map(suggestion => (
                  <li key={suggestion}>
                    <button
                      onClick={() => sendMessage(suggestion)}
                      disabled={streaming}
                      className="w-full text-left text-sm text-muted-foreground hover:text-foreground
                                 border border-muted-foreground/20 hover:border-primary/50
                                 bg-muted/30 hover:bg-muted/50
                                 rounded-lg px-3 py-2 transition-colors disabled:opacity-50"
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {messages.map((msg, i) => {
          // Show a skeleton bubble for the empty assistant message during the
          // initial wait before any token/tool arrives.
          const isEmptyAssistant =
            msg.role === 'assistant' && msg.content === '' && streaming && i === messages.length - 1;

          return (
            <div
              key={i}
              className={`flex animate-slide-up ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              style={{
                // animationDelay cannot be expressed as a Tailwind class with a dynamic value;
                // inline style is intentional, not an oversight.
                animationDelay: `${Math.min(i * 30, 150)}ms`,
              }}
            >
              {isEmptyAssistant ? (
                /* Skeleton bubble while waiting for the first token */
                <div className="max-w-[60%] rounded-2xl rounded-bl-sm overflow-hidden">
                  <div className="skeleton h-10 w-48" />
                </div>
              ) : (
                <div className={`max-w-[80%] rounded-2xl px-4 py-3 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary text-primary-foreground rounded-br-sm'
                    : 'bg-muted rounded-bl-sm'
                }`}>
                  {msg.role === 'assistant' && msg.memories && msg.memories.length > 0 && (
                    <MemoryViewer memories={msg.memories} />
                  )}
                  {renderContent(msg.content, msg.citations)}
                </div>
              )}
            </div>
          );
        })}

        {/* Tool call indicator or typing indicator — suppressed while skeleton bubble is active */}
        {streaming && activeTool && !hasSkeletonBubble && <ToolCallIndicator activeTool={activeTool} />}
        {streaming && !activeTool && !hasSkeletonBubble && (
          /* Typing indicator: 3 animated dots when the model is generating text */
          <div className="flex justify-start" aria-label="Assistant is typing">
            <div className="bg-muted rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
              <span
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
                style={{ animationDelay: '0ms', animationDuration: '900ms' }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
                style={{ animationDelay: '200ms', animationDuration: '900ms' }}
              />
              <span
                className="h-1.5 w-1.5 rounded-full bg-muted-foreground/60 animate-bounce"
                style={{ animationDelay: '400ms', animationDuration: '900ms' }}
              />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input area */}
      <div className="border-t p-3 shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder="Ask about your documents…"
            disabled={streaming}
            className="flex-1 rounded-lg border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50"
          />
          <button
            onClick={() => sendMessage()}
            disabled={streaming || !input.trim()}
            aria-label="Send message"
            className="rounded-lg bg-primary px-3 py-2 text-primary-foreground disabled:opacity-50 hover:bg-primary/90 transition-colors"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  )
}
