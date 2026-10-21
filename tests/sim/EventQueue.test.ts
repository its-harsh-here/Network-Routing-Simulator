import { describe, expect, it } from 'vitest'
import { EventQueue, type ScheduledEvent } from '../../src/sim/EventQueue.ts'
import { Rng } from '../../src/sim/rng.ts'

/** Pops every event and returns their payloads in order. */
function drain<E>(queue: EventQueue<E>): E[] {
  const out: E[] = []
  for (let next = queue.next(); next !== undefined; next = queue.next()) out.push(next.event)
  return out
}

describe('EventQueue', () => {
  it('starts empty', () => {
    const queue = new EventQueue<string>()
    expect(queue.size).toBe(0)
    expect(queue.peekTime()).toBeUndefined()
    expect(queue.next()).toBeUndefined()
  })

  it('returns events earliest first', () => {
    const queue = new EventQueue<string>()
    queue.schedule(30, 'c')
    queue.schedule(10, 'a')
    queue.schedule(20, 'b')
    expect(queue.size).toBe(3)
    expect(queue.peekTime()).toBe(10)
    expect(drain(queue)).toEqual(['a', 'b', 'c'])
  })

  it('runs events at the same time in the order they were scheduled', () => {
    const queue = new EventQueue<string>()
    for (const name of ['first', 'second', 'third', 'fourth', 'fifth']) queue.schedule(5, name)
    queue.schedule(1, 'early')
    expect(drain(queue)).toEqual(['early', 'first', 'second', 'third', 'fourth', 'fifth'])
  })

  it('reports time and sequence number with each event', () => {
    const queue = new EventQueue<string>()
    queue.schedule(7.5, 'x')
    expect(queue.next()).toEqual({ time: 7.5, seq: 0, event: 'x' })
  })

  it('peekTime does not remove anything', () => {
    const queue = new EventQueue<string>()
    queue.schedule(3, 'x')
    expect(queue.peekTime()).toBe(3)
    expect(queue.peekTime()).toBe(3)
    expect(queue.size).toBe(1)
  })

  it('rejects times that are not finite', () => {
    const queue = new EventQueue<string>()
    for (const time of [NaN, Infinity, -Infinity]) {
      expect(() => queue.schedule(time, 'x')).toThrow(RangeError)
    }
    expect(queue.size).toBe(0)
  })

  it('matches a linear-scan reference on random schedules and pops', () => {
    const rng = new Rng(4040)
    const queue = new EventQueue<number>()
    // Reference: a plain list; next() scans for the smallest (time, seq).
    const reference: ScheduledEvent<number>[] = []
    let seq = 0
    for (let step = 0; step < 5_000; step++) {
      if (rng.uniform() < 0.55) {
        const time = rng.randomInt(0, 20) // a small range gives many ties
        queue.schedule(time, step)
        reference.push({ time, seq: seq++, event: step })
      } else {
        let best = -1
        for (let i = 0; i < reference.length; i++) {
          const r = reference[i]
          const b = reference[best]
          if (best === -1 || r.time < b.time || (r.time === b.time && r.seq < b.seq)) best = i
        }
        const expected = best === -1 ? undefined : reference.splice(best, 1)[0]
        expect(queue.next()).toEqual(expected)
      }
      expect(queue.size).toBe(reference.length)
    }
  })
})
