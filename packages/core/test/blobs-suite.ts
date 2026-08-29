/**
 * The behaviour every Blobs implementation has to have.
 *
 * The same argument as `store-suite.ts`: an adapter that passes a suite
 * written for it is not interchangeable with anything. This one is worth more
 * than most, because of the failures it catches: a `get` on a missing key
 * throwing instead of answering null, or metadata that does not survive a
 * round trip. Those are exactly what a hand-written test forgets to check, and
 * exactly what breaks a deployment on a different provider.
 *
 * Monorepo scaffolding, not shipped.
 */
import { describe, expect, it } from 'vitest'
import type { Blobs } from '../src/storage/blobs.js'

const encoder = new TextEncoder()

export function bytes(text: string): Uint8Array {
  return encoder.encode(text)
}

export function blobBehaviour(name: string, make: () => Promise<Blobs> | Blobs): void {
  describe(`${name} blobs`, () => {
    const key = () => `test/${Math.random().toString(36).slice(2, 10)}.txt`

    it('reads back exactly what was written', async () => {
      const blobs = await make()
      const at = key()
      await blobs.put(at, bytes('hello there'), { mimeType: 'text/plain' })

      const found = await blobs.get(at)
      expect(found).not.toBeNull()
      expect(new TextDecoder().decode(found?.bytes)).toBe('hello there')
      expect(found?.mimeType).toBe('text/plain')
      expect(found?.size).toBe(11)
    })

    it('answers null for a key that was never written', async () => {
      const blobs = await make()
      expect(await blobs.get('test/never-written.txt')).toBeNull()
      expect(await blobs.head('test/never-written.txt')).toBeNull()
    })

    it('describes an object without downloading it', async () => {
      const blobs = await make()
      const at = key()
      await blobs.put(at, bytes('0123456789'), { mimeType: 'text/plain', filename: 'notes.txt' })

      const info = await blobs.head(at)
      expect(info?.size).toBe(10)
      expect(info?.mimeType).toBe('text/plain')
      expect(info?.filename).toBe('notes.txt')
    })

    it('overwrites a key rather than failing on it', async () => {
      const blobs = await make()
      const at = key()
      await blobs.put(at, bytes('first'), { mimeType: 'text/plain' })
      await blobs.put(at, bytes('second'), { mimeType: 'text/plain' })

      expect(new TextDecoder().decode((await blobs.get(at))?.bytes)).toBe('second')
    })

    it('deletes, and deleting twice is not an error', async () => {
      const blobs = await make()
      const at = key()
      await blobs.put(at, bytes('temporary'), { mimeType: 'text/plain' })
      await blobs.delete(at)
      await blobs.delete(at)

      expect(await blobs.get(at)).toBeNull()
    })

    it('keeps binary content byte for byte', async () => {
      const blobs = await make()
      const at = `test/${Math.random().toString(36).slice(2, 10)}.bin`
      // Every byte value, so a backend that decodes as UTF-8 somewhere fails
      // here rather than on somebody's photograph.
      const payload = new Uint8Array(256)
      for (let index = 0; index < 256; index++) payload[index] = index

      await blobs.put(at, payload, { mimeType: 'application/octet-stream' })
      const found = await blobs.get(at)

      expect(found?.bytes).toEqual(payload)
    })

    it('handles a filename that is not ASCII', async () => {
      const blobs = await make()
      const at = key()
      // Header values are ASCII, so a name like this has to be encoded on the
      // way out and decoded on the way back. Arabic, because that is the case
      // a European test corpus never covers.
      await blobs.put(at, bytes('x'), { mimeType: 'text/plain', filename: 'فاتورة.pdf' })

      expect((await blobs.head(at))?.filename).toBe('فاتورة.pdf')
    })

    it('stores an empty object without pretending it is missing', async () => {
      const blobs = await make()
      const at = key()
      await blobs.put(at, new Uint8Array(), { mimeType: 'text/plain' })

      const found = await blobs.get(at)
      expect(found).not.toBeNull()
      expect(found?.size).toBe(0)
    })
  })
}
