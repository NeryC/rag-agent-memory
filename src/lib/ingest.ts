import { createServerClient } from '@/lib/supabase'
import { inflateSync } from 'zlib'

const CHUNK_TOKENS = 500
const OVERLAP_TOKENS = 50
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY!
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN ?? ''

/**
 * Extract text from a PDF buffer.
 * Handles both plain and FlateDecode (zlib) compressed content streams.
 * Works in any Node.js environment without browser API dependencies.
 */
function extractPdfText(buffer: Buffer): string {
  const raw = buffer.toString('latin1')
  const texts: string[] = []

  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
  let m: RegExpExecArray | null

  while ((m = streamRegex.exec(raw)) !== null) {
    const streamStart = m.index
    const streamData = m[1]

    // Check the preceding object dict for compression filter
    const preceding = raw.slice(Math.max(0, streamStart - 500), streamStart)
    const isFlate = preceding.includes('FlateDecode')

    let content: string
    if (isFlate) {
      try {
        const compressed = Buffer.from(streamData, 'latin1')
        const decompressed = inflateSync(compressed)
        content = decompressed.toString('utf8')
      } catch {
        continue // skip unreadable compressed streams
      }
    } else {
      content = streamData
    }

    if (!content.includes('Tj') && !content.includes('TJ')) continue

    // Extract from Tj operator: (text) Tj
    for (const t of content.matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)\s*Tj/g)) {
      const s = t[1]
        .replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t')
        .replace(/\\\(/g, '(').replace(/\\\)/g, ')').replace(/\\\\/g, '\\')
        .replace(/\\(\d{3})/g, (_, oct) => String.fromCharCode(parseInt(oct, 8)))
      if (s.trim()) texts.push(s)
    }

    // Extract from TJ operator: [(text) offset ...] TJ
    for (const t of content.matchAll(/\[([^\]]+)\]\s*TJ/g)) {
      for (const p of t[1].matchAll(/\(([^)\\]*(?:\\.[^)\\]*)*)\)/g)) {
        const s = p[1].replace(/\\n/g, '\n')
        if (s.trim()) texts.push(s)
      }
    }
  }

  return texts.join(' ').replace(/\s+/g, ' ').trim()
}

function roughTokenCount(text: string): number {
  return Math.max(1, Math.floor(text.length / 4))
}

function chunkText(pages: { pageNum: number; text: string }[]): { content: string; pageNumber: number }[] {
  const chunks: { content: string; pageNumber: number }[] = []
  let buffer = ''
  let bufferPage = 1

  for (const { pageNum, text } of pages) {
    const paragraphs = text.split(/\n\n+/).map(p => p.trim()).filter(Boolean)
    for (const para of paragraphs) {
      if (roughTokenCount(buffer) + roughTokenCount(para) > CHUNK_TOKENS && buffer) {
        chunks.push({ content: buffer.trim(), pageNumber: bufferPage })
        const words = buffer.split(/\s+/)
        const overlapWords = Math.max(1, Math.floor((OVERLAP_TOKENS * 4) / 5))
        buffer = words.slice(-overlapWords).join(' ') + ' '
        bufferPage = pageNum
      }
      buffer += para + '\n\n'
      if (!bufferPage) bufferPage = pageNum
    }
  }

  if (buffer.trim()) {
    chunks.push({ content: buffer.trim(), pageNumber: bufferPage })
  }

  return chunks
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const res = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ input: texts, model: 'voyage-3', input_type: 'document' }),
  })
  if (!res.ok) throw new Error(`Voyage AI error: ${res.status} ${await res.text()}`)
  const data = await res.json()
  return data.data.map((d: { embedding: number[] }) => d.embedding)
}

export async function processDocument(
  blobUrl: string,
  filename: string,
  documentId: string,
  sessionId: string,
): Promise<void> {
  const supabase = createServerClient()

  try {
    // Download PDF from Vercel Blob (private store requires auth)
    const headers: Record<string, string> = {}
    if (BLOB_READ_WRITE_TOKEN) headers['Authorization'] = `Bearer ${BLOB_READ_WRITE_TOKEN}`
    const blobRes = await fetch(blobUrl, { headers })
    if (!blobRes.ok) throw new Error(`Blob fetch failed: ${blobRes.status}`)

    const pdfBuffer = Buffer.from(await blobRes.arrayBuffer())
    const fullText = extractPdfText(pdfBuffer)

    if (!fullText || fullText.length < 10) {
      console.error(`[ingest] No text extracted from ${filename} (${pdfBuffer.length} bytes)`)
      await supabase.from('documents').update({ status: 'error' }).eq('id', documentId)
      return
    }

    const pages = [{ pageNum: 1, text: fullText }]
    const chunks = chunkText(pages)

    if (chunks.length === 0) {
      await supabase.from('documents').update({ status: 'error' }).eq('id', documentId)
      return
    }

    // Embed in batches of 100
    const texts = chunks.map(c => c.content)
    const allEmbeddings: number[][] = []
    for (let i = 0; i < texts.length; i += 100) {
      const batch = await embedBatch(texts.slice(i, i + 100))
      allEmbeddings.push(...batch)
    }

    // Insert chunks into Supabase
    const rows = chunks.map((chunk, idx) => ({
      document_id: documentId,
      session_id: sessionId,
      content: chunk.content,
      embedding: allEmbeddings[idx],
      chunk_index: idx,
      page_number: chunk.pageNumber,
    }))

    await supabase.from('chunks').insert(rows)
    await supabase
      .from('documents')
      .update({ status: 'ready', chunk_count: rows.length })
      .eq('id', documentId)

    console.log(`[ingest] ${filename}: ${chunks.length} chunks ingested`)
  } catch (err) {
    console.error('[ingest] error:', err)
    await supabase.from('documents').update({ status: 'error' }).eq('id', documentId)
    throw err
  }
}
