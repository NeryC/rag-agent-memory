import { createServerClient } from '@/lib/supabase'

const CHUNK_TOKENS = 500
const OVERLAP_TOKENS = 50
const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY!
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN ?? ''

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

    // Parse PDF with pdf-parse (dynamic import to avoid Next.js build issues)
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pdfParse: (buffer: Buffer) => Promise<{ text: string; numpages: number }> = require('pdf-parse')
    const pdfData = await pdfParse(pdfBuffer)

    // pdf-parse gives us all text; split by pages using npage info
    // For simplicity, treat the entire text as page 1 (single-page approach)
    const fullText = pdfData.text
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

    // Insert chunks
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
  } catch (err) {
    console.error('[ingest] error:', err)
    await supabase.from('documents').update({ status: 'error' }).eq('id', documentId)
    throw err
  }
}
