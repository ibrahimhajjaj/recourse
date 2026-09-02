import { describe, expect, it } from 'vitest'
import { repairNumericContent } from '../src/models.js'

/**
 * The frame Cloudflare's OpenAI-compatible endpoint actually sent, copied from
 * a Worker's own logs. `content` is the number 6 where the protocol says a
 * string, which is what a client's schema rejects mid-answer.
 */
const REAL = {
  id: 'id-1788378160014',
  created: 1788378160,
  model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  object: 'chat.completion.chunk',
  choices: [{ index: 0, delta: { content: 6 } }],
}

function streaming(body: string, type = 'text/event-stream'): typeof globalThis.fetch {
  return async () =>
    new Response(new Blob([body]).stream(), { status: 200, headers: { 'Content-Type': type } })
}

/** The body a caller would read, after the repair. */
async function through(body: string, type?: string): Promise<string> {
  const repaired = repairNumericContent(streaming(body, type))
  return await (await repaired('https://example.invalid')).text()
}

describe('repairing a streamed token that arrived as a number', () => {
  it('puts a number back to the text it should have been', async () => {
    const out = await through(`data: ${JSON.stringify(REAL)}\n\n`)
    expect(JSON.parse(out.slice(5).trim()).choices[0].delta.content).toBe('6')
  })

  it('leaves a well-formed frame byte for byte alone', async () => {
    const good = `data: {"choices":[{"delta":{"content":"hello"}}]}\n\n`
    expect(await through(good)).toBe(good)
  })

  it('leaves null alone, which is how the protocol says "no text here"', async () => {
    const none = `data: {"choices":[{"delta":{"content":null}}]}\n\n`
    expect(await through(none)).toBe(none)
  })

  it('repairs a line split across two network chunks', async () => {
    const line = `data: ${JSON.stringify(REAL)}\n\n`
    const half = Math.floor(line.length / 2)
    const split = new ReadableStream<Uint8Array>({
      start(controller) {
        const encode = new TextEncoder()
        controller.enqueue(encode.encode(line.slice(0, half)))
        controller.enqueue(encode.encode(line.slice(half)))
        controller.close()
      },
    })

    const repaired = repairNumericContent(
      async () => new Response(split, { headers: { 'Content-Type': 'text/event-stream' } }),
    )
    const out = await (await repaired('https://example.invalid')).text()

    expect(JSON.parse(out.slice(5).trim()).choices[0].delta.content).toBe('6')
  })

  it('passes the done sentinel through untouched', async () => {
    expect(await through('data: [DONE]\n\n')).toBe('data: [DONE]\n\n')
  })

  it('passes a line that is not JSON through rather than swallowing it', async () => {
    expect(await through('data: not json at all\n\n')).toBe('data: not json at all\n\n')
  })

  it('does not touch a body that is not a stream', async () => {
    const json = '{"choices":[{"message":{"content":"hello"}}]}'
    expect(await through(json, 'application/json')).toBe(json)
  })

  it('turns a boolean into text too, since it parsed the same way', async () => {
    const out = await through(`data: {"choices":[{"delta":{"content":true}}]}\n\n`)
    expect(JSON.parse(out.slice(5).trim()).choices[0].delta.content).toBe('true')
  })
})
