import { describe, expect, it } from 'vitest'

describe('the no-network guard', () => {
  it('refuses a relative URL, which happy-dom would send to port 3000', async () => {
    await expect(fetch('/api/chat', { method: 'POST' })).rejects.toThrow(/reached the network/)
  })
})
