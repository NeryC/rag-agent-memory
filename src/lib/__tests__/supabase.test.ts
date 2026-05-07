import { describe, it, expect } from 'vitest'
import { createServerClient } from '../supabase'

describe('supabase client', () => {
  it('createServerClient does not throw with env vars set', () => {
    process.env.SUPABASE_URL = 'https://test.supabase.co'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJfake'
    expect(() => createServerClient()).not.toThrow()
  })
})