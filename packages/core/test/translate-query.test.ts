import { describe, expect, it, vi } from 'vitest'
import { embedderSpansLanguages, needsTranslation, translateQuery } from '../src/knowledge/translate-query.js'
import { MockLanguageModelV4 } from 'ai/test'

/** A model that reports what it was asked and answers with a fixed string. */
function translator(reply = 'how long does delivery take to Los Angeles', seen: string[] = []) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      seen.push(JSON.stringify(options.prompt))

      return {
        finishReason: 'stop' as const,
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 8, text: 8, reasoning: 0 },
        },
        content: [{ type: 'text' as const, text: reply }],
        warnings: [],
      }
    },
  })
}

describe('deciding whether a question needs translating', () => {
  it('says yes for a script the content is not written in', () => {
    // The case that started this: an Arabic question against English pages
    // that answer it in full, returning nothing.
    expect(needsTranslation('كم يستغرق التوصيل إلى لوس أنجلوس؟')).toBe(true)
    expect(needsTranslation('配送にはどのくらいかかりますか')).toBe(true)
    expect(needsTranslation('сколько идёт доставка')).toBe(true)
  })

  it('says no for the language the content is already in', () => {
    // Paying for a translation on every English question to catch the rare
    // French one is the wrong trade.
    expect(needsTranslation('how long does delivery take?')).toBe(false)
    expect(needsTranslation('LUM-1234 refund please')).toBe(false)
  })

  it('still says yes when a question mixes scripts', () => {
    // Somebody writing Arabic but naming an English city, which is how people
    // actually type.
    expect(needsTranslation('ممكن أعرف التوصيل لـ Los Angeles كم بياخد وقت؟')).toBe(true)
  })

  it('says no to something with no letters at all', () => {
    expect(needsTranslation('12345 !!')).toBe(false)
    expect(needsTranslation('   ')).toBe(false)
  })
})

describe('translating the search key', () => {
  it('translates a question in another script', async () => {
    const seen: string[] = []
    const asked = await translateQuery('كم يستغرق التوصيل؟', {
      indexLanguage: 'English',
      model: translator('how long does delivery take', seen),
    })

    expect(asked).toBe('how long does delivery take')
    expect(seen).toHaveLength(1)
  })

  it('does not call the model for a question already in that language', async () => {
    // The reason the cheap check exists: this runs before retrieval, on the
    // clock, on every single question.
    const seen: string[] = []
    const asked = await translateQuery('how long does delivery take?', {
      indexLanguage: 'English',
      model: translator('unused', seen),
    })

    expect(asked).toBe('how long does delivery take?')
    expect(seen).toEqual([])
  })

  it('keeps the original question when the model fails', async () => {
    // Searching with the untranslated question is what happened before this
    // existed. Failing the turn over a translation would be worse.
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const broken = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new Error('provider down')
      },
    })

    const original = 'كم يستغرق التوصيل؟'
    expect(await translateQuery(original, { indexLanguage: 'English', model: broken })).toBe(original)
    errors.mockRestore()
  })

  it('keeps the original when the model returns nothing', async () => {
    const empty = translator('   ')

    const original = 'كم يستغرق التوصيل؟'
    expect(await translateQuery(original, { indexLanguage: 'English', model: empty })).toBe(original)
  })

  it('asks for the translation alone, not an explanation of it', async () => {
    // A model that answers "The translation is: ..." puts those words into the
    // search key, and they match nothing.
    const seen: string[] = []
    await translateQuery('كم يستغرق التوصيل؟', {
      indexLanguage: 'English',
      model: translator('how long does delivery take', seen),
    })

    expect(seen[0]).toContain('nothing else')
  })
})

describe('choosing between translating and trusting the embedder', () => {
  it('trusts an embedder that spans languages, which needs no extra call', () => {
    for (const model of [
      'text-embedding-3-small',
      'text-embedding-3-large',
      'intfloat/multilingual-e5-large',
      'bge-m3',
      'jina-embeddings-v3',
      'LaBSE',
    ]) {
      expect(embedderSpansLanguages(model), model).toBe(true)
    }
  })

  it('translates for an English-centric embedder', () => {
    // nomic-embed-text is the one people actually have locally, and it is
    // English-centric, which is why an Arabic question found nothing.
    for (const model of ['nomic-embed-text', 'all-MiniLM-L6-v2', 'bge-large-en-v1.5']) {
      expect(embedderSpansLanguages(model), model).toBe(false)
    }
  })

  it('treats an unknown embedder as English-centric', () => {
    // Translating when it was not needed costs a few hundred milliseconds.
    // Skipping it when it was needed costs the answer.
    expect(embedderSpansLanguages('some-in-house-model')).toBe(false)
    expect(embedderSpansLanguages(undefined)).toBe(false)
  })
})

describe('languages that look Latin but are not the content', () => {
  it('catches the ones a script check misses', () => {
    // The first version of this only looked at script, so every one of these
    // sailed through untranslated and retrieved nothing.
    for (const question of [
      'combien de temps prend la livraison en France',
      'cuánto tarda el envío a Madrid',
      'wie lange dauert der Versand nach Berlin',
      'quanto tempo demora a entrega',
      'quanto tempo impiega la consegna',
      'kargo ne kadar sürüyor acaba',
      'giao hàng mất bao lâu vậy',
    ]) {
      expect(needsTranslation(question), question).toBe(true)
    }
  })

  it('still leaves English alone', () => {
    for (const question of [
      'how long does delivery take to Los Angeles',
      'can I get a refund on my order',
      'what is the shipping cost for the US',
      'my subscription needs pausing please',
    ]) {
      expect(needsTranslation(question), question).toBe(false)
    }
  })

  it('does not judge a fragment too short to read', () => {
    // "refund?" is not evidence of a language.
    expect(needsTranslation('refund?')).toBe(false)
    expect(needsTranslation('LUM-1234')).toBe(false)
  })

  it('searches an index in another language on its own terms', () => {
    // A French shop's content, asked in French, must not be translated.
    expect(needsTranslation('combien de temps prend la livraison', 'French')).toBe(false)
    expect(needsTranslation('how long does delivery take', 'French')).toBe(true)
  })

  it('leaves questions alone for an index language it has no words for', () => {
    // Guessing would translate every question it ever saw.
    expect(needsTranslation('how long does delivery take', 'Swahili')).toBe(false)
  })
})
