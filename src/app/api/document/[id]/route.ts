import { NextRequest, NextResponse } from 'next/server'
import { del } from '@vercel/blob'
import { createServerClient } from '@/lib/supabase'
import { getOrCreateSessionId } from '@/lib/session'

export const runtime = 'nodejs'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const sessionId = await getOrCreateSessionId()
  const supabase = createServerClient()

  const { data: doc } = await supabase
    .from('documents')
    .select('blob_url')
    .eq('id', id)
    .eq('session_id', sessionId)
    .single()

  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await supabase.from('chunks').delete().eq('document_id', id)
  await supabase.from('documents').delete().eq('id', id)

  if (doc.blob_url) {
    try { await del(doc.blob_url) } catch { /* best-effort */ }
  }

  return NextResponse.json({ ok: true })
}
