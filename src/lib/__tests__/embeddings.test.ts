import { describe, it, expect } from 'vitest'

describe('embed helper', () => {
  it('embeddings module exports embed function', async () => {
    // Dynamic import just verifies the module structure
    const mod = await import('../embeddings')
    expect(typeof mod.embed).toBe('function')
  })
})
