import { cookies } from 'next/headers'
import { randomUUID } from 'crypto'

const SESSION_COOKIE = 'rag_session'
const TTL_SECONDS = 24 * 60 * 60

export async function getOrCreateSessionId(): Promise<string> {
  const cookieStore = await cookies()
  const existing = cookieStore.get(SESSION_COOKIE)
  if (existing?.value) return existing.value
  return randomUUID()
}

export function sessionCookieOptions() {
  return {
    name: SESSION_COOKIE,
    httpOnly: true,
    sameSite: 'lax' as const,
    maxAge: TTL_SECONDS,
    path: '/',
  }
}
