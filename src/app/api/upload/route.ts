import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { createServerClient } from '@/lib/supabase'
import { getOrCreateSessionId, sessionCookieOptions } from '@/lib/session'
import { processDocument } from '@/lib/ingest'

export const runtime = 'nodejs'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  try {
    const sessionId = await getOrCreateSessionId()
    const supabase = createServerClient()

    const form = await req.formData()
    const file = form.get('file') as File | null
    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 })
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      return NextResponse.json({ error: 'Only PDF files are supported' }, { status: 400 })
    }

    const { count } = await supabase
      .from('documents')
      .select('id', { count: 'exact', head: true })
      .eq('session_id', sessionId)
    if ((count ?? 0) >= 5) {
      return NextResponse.json({ error: 'Session document limit (5) reached' }, { status: 429 })
    }

    const blob = await put(`sessions/${sessionId}/${Date.now()}-${file.name}`, file, {
      access: 'private',
      addRandomSuffix: false,
    })

    const { data: doc, error } = await supabase
      .from('documents')
      .insert({
        session_id: sessionId,
        filename: file.name,
        blob_url: blob.url,
        status: 'processing',
      })
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Ingest synchronously — processes PDF, embeds chunks, marks ready/error
    // Runs before response so Hobby plan 10s window covers everything for small PDFs
    await processDocument(blob.url, file.name, doc.id, sessionId)

    const response = NextResponse.json({ document_id: doc.id, status: 'ready' })
    const opts = sessionCookieOptions()
    response.cookies.set(opts.name, sessionId, opts)
    return response
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[upload] unhandled error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
