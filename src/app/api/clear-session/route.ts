import { NextResponse } from 'next/server'
import { sessionCookieOptions } from '@/lib/session'

export async function GET() {
  const response = NextResponse.json({ cleared: true })
  const opts = sessionCookieOptions()
  // Expire the session cookie so the browser starts fresh
  response.cookies.set(opts.name, '', { ...opts, maxAge: 0 })
  return response
}
