import { afterEach, describe, expect, it } from 'vitest'
import { models, embedders } from '../src/models.js'

/**
 * These are sugar over three lines of configuration, so the only thing worth
 * testing is that the sugar resolves to what it says it does.
 */

const saved = { ...process.env }

afterEach(() => {
  process.env = { ...saved }
})

describe('picking a model', () => {
  it('passes a gateway id through unchanged', () => {
    // A bare string is already a gateway model to the AI SDK. The function
    // exists to give the choice a name in a config file.
    expect(models.gateway('openai/gpt-4o-mini')).toBe('openai/gpt-4o-mini')
  })

  it('builds a local model against Ollama by default', () => {
    const model = models.local()
    expect(typeof model).not.toBe('string')
    expect((model as { modelId?: string }).modelId).toBe('qwen3:4b')
  })

  it('takes any OpenAI-compatible endpoint', () => {
    const model = models.openaiCompatible({
      baseURL: 'https://openrouter.ai/api/v1',
      apiKey: 'sk-test',
      model: 'meta-llama/llama-3.1-70b',
    })

    expect((model as { modelId?: string }).modelId).toBe('meta-llama/llama-3.1-70b')
  })
})

describe('reading the environment', () => {
  it('prefers a configured endpoint over the gateway', () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:11434/v1'
    process.env.OPENAI_COMPATIBLE_MODEL = 'granite4.1:8b'

    const model = models.fromEnvironment()
    expect((model as { modelId?: string }).modelId).toBe('granite4.1:8b')
  })

  it('needs both the endpoint and the model, not one of them', () => {
    // Half a configuration is a mistake, and silently ignoring it would send
    // traffic somewhere the operator did not intend.
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:11434/v1'
    delete process.env.OPENAI_COMPATIBLE_MODEL
    delete process.env.HELPDECK_MODEL

    expect(models.fromEnvironment()).toBe('openai/gpt-4o-mini')
  })

  it('falls back to the gateway, then to the given default', () => {
    delete process.env.OPENAI_COMPATIBLE_BASE_URL
    delete process.env.OPENAI_COMPATIBLE_MODEL

    process.env.HELPDECK_MODEL = 'anthropic/claude-haiku-4-5'
    expect(models.fromEnvironment()).toBe('anthropic/claude-haiku-4-5')

    delete process.env.HELPDECK_MODEL
    expect(models.fromEnvironment('openai/gpt-5')).toBe('openai/gpt-5')
  })
})

describe('picking an embedder', () => {
  it('defaults to the model the index is usually built with', () => {
    expect(embedders.local().name).toContain('nomic-embed-text')
  })

  it('is absent when no endpoint is configured, so the Gateway is used', () => {
    delete process.env.OPENAI_COMPATIBLE_BASE_URL
    expect(embedders.fromEnvironment()).toBeUndefined()
  })

  it('matches whatever the model helper chose', () => {
    process.env.OPENAI_COMPATIBLE_BASE_URL = 'http://localhost:11434/v1'
    process.env.OPENAI_COMPATIBLE_EMBED_MODEL = 'mxbai-embed-large'

    expect(embedders.fromEnvironment()?.name).toContain('mxbai-embed-large')
  })
})
