import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'
import { getOrCreateSessionId } from '@/lib/session'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const sessionId = await getOrCreateSessionId()
  const supabase = createServerClient()

  const { data, error } = await supabase
    .from('chunks')
    .select('content')
    .eq('id', id)
    .eq('session_id', sessionId)
    .single()

  if (error || !data) {
    return NextResponse.json({ error: 'Chunk not found' }, { status: 404 })
  }

  return NextResponse.json({ content: data.content })
}
