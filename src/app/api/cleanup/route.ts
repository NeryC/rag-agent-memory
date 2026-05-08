import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  // Optional bearer-token auth — set CLEANUP_SECRET env var to enable
  const secret = process.env.CLEANUP_SECRET
  if (secret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${secret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const supabase = createServerClient()
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  // Delete chunks before documents to satisfy the FK constraint
  await supabase.from('chunks').delete().lt('created_at', cutoff)
  await supabase.from('conversations').delete().lt('created_at', cutoff)
  await supabase.from('documents').delete().lt('uploaded_at', cutoff)
  await supabase.from('memories').delete().lt('created_at', cutoff)

  return NextResponse.json({ ok: true, cutoff })
}
