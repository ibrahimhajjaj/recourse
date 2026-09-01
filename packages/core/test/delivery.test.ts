import { describe, expect, it, vi } from 'vitest'
import { createDeliveryLog, type DeliveryState } from '../src/channels/delivery.js'

const update = (messageId: string, state: DeliveryState) =>
  ({ messageId, state, channel: 'whatsapp' as const })

describe('status updates that arrive out of order', () => {
  it('moves forward', () => {
    const log = createDeliveryLog()

    expect(log.apply(update('m1', 'sent'))).toBe(true)
    expect(log.apply(update('m1', 'delivered'))).toBe(true)
    expect(log.apply(update('m1', 'read'))).toBe(true)
    expect(log.stateOf('m1')).toBe('read')
  })

  it('never moves backwards', () => {
    // Meta can hand you `sent` after `read`. Applied naively the customer who
    // has read the message shows as merely sent.
    const log = createDeliveryLog()
    log.apply(update('m1', 'read'))

    expect(log.apply(update('m1', 'sent'))).toBe(false)
    expect(log.apply(update('m1', 'delivered'))).toBe(false)
    expect(log.stateOf('m1')).toBe('read')
  })

  it('treats the same state arriving twice as nothing new', () => {
    // The bug this stops: a re-delivered `failed` sending the fallback twice.
    const log = createDeliveryLog()
    log.apply(update('m1', 'delivered'))

    expect(log.apply(update('m1', 'delivered'))).toBe(false)
  })

  it('lets a failure through even after a read', () => {
    // Read on one device and rejected on another is a real thing, and the
    // failure is the more important of the two to surface.
    const log = createDeliveryLog()
    log.apply(update('m1', 'read'))

    expect(log.apply(update('m1', 'failed'))).toBe(true)
    expect(log.stateOf('m1')).toBe('failed')
  })

  it('keeps messages apart', () => {
    const log = createDeliveryLog()
    log.apply(update('m1', 'read'))
    log.apply(update('m2', 'sent'))

    expect(log.stateOf('m1')).toBe('read')
    expect(log.stateOf('m2')).toBe('sent')
  })

  it('says nothing about a message it has not heard of', () => {
    expect(createDeliveryLog().stateOf('unknown')).toBeUndefined()
  })
})

describe('telling the host only when something changed', () => {
  it('calls back on a real move, with what it was before', () => {
    const seen: Array<[DeliveryState, DeliveryState | undefined]> = []
    const log = createDeliveryLog({ onChange: (u, previous) => void seen.push([u.state, previous]) })

    log.apply(update('m1', 'sent'))
    log.apply(update('m1', 'delivered'))

    expect(seen).toEqual([['sent', undefined], ['delivered', 'sent']])
  })

  it('stays quiet on a duplicate or a late one', () => {
    const onChange = vi.fn()
    const log = createDeliveryLog({ onChange })
    log.apply(update('m1', 'read'))
    onChange.mockClear()

    log.apply(update('m1', 'read'))
    log.apply(update('m1', 'sent'))

    expect(onChange).not.toHaveBeenCalled()
  })
})

describe('a line busy enough to run for months', () => {
  it('drops the oldest rather than growing for ever', () => {
    const log = createDeliveryLog({ maxEntries: 3 })
    for (const id of ['m1', 'm2', 'm3', 'm4']) log.apply(update(id, 'sent'))

    expect(log.stateOf('m1')).toBeUndefined()
    expect(log.stateOf('m4')).toBe('sent')
    expect(log.entries()).toHaveLength(3)
  })
})
