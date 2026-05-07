import { NextResponse } from 'next/server'
import { createServerClient } from '@/lib/supabase'

export async function GET() {
  const supabase = createServerClient()
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

  await supabase.from('conversations').delete().lt('created_at', cutoff)
  await supabase.from('documents').delete().lt('uploaded_at', cutoff)
  await supabase.from('memories').delete().lt('created_at', cutoff)

  return NextResponse.json({ ok: true, cutoff })
}
