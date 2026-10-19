import { describe, expect, it } from 'vitest'
import { RingBuffer } from '../../src/ds/RingBuffer.ts'
import { Rng } from '../../src/sim/rng.ts'

describe('RingBuffer', () => {
  it('rejects a capacity that is not a positive integer', () => {
    for (const capacity of [0, -1, 2.5, NaN, Infinity]) {
      expect(() => new RingBuffer(capacity)).toThrow(RangeError)
    }
  })

  it('starts empty in drop-tail mode', () => {
    const buffer = new RingBuffer<number>(3)
    expect(buffer.capacity).toBe(3)
    expect(buffer.mode).toBe('drop-tail')
    expect(buffer.size).toBe(0)
    expect(buffer.isEmpty()).toBe(true)
    expect(buffer.isFull()).toBe(false)
    expect(buffer.peek()).toBeUndefined()
    expect(buffer.dequeue()).toBeUndefined()
    expect([...buffer]).toEqual([])
  })

  it('is first-in first-out', () => {
    const buffer = new RingBuffer<string>(5)
    buffer.enqueue('a')
    buffer.enqueue('b')
    buffer.enqueue('c')
    expect(buffer.peek()).toBe('a')
    expect(buffer.dequeue()).toBe('a')
    expect(buffer.dequeue()).toBe('b')
    expect(buffer.dequeue()).toBe('c')
    expect(buffer.dequeue()).toBeUndefined()
  })

  it('wraps around the end of the array and still iterates oldest to newest', () => {
    const buffer = new RingBuffer<number>(3)
    buffer.enqueue(1)
    buffer.enqueue(2)
    buffer.enqueue(3)
    expect(buffer.dequeue()).toBe(1)
    expect(buffer.dequeue()).toBe(2)
    buffer.enqueue(4)
    buffer.enqueue(5)
    expect([...buffer]).toEqual([3, 4, 5])
    expect(buffer.peek()).toBe(3)
    expect(buffer.isFull()).toBe(true)
  })

  it('stores duplicate values', () => {
    const buffer = new RingBuffer<number>(4)
    for (const n of [7, 7, 7]) buffer.enqueue(n)
    expect([...buffer]).toEqual([7, 7, 7])
    expect(buffer.size).toBe(3)
  })

  describe('drop-tail mode', () => {
    it('rejects an item when full and keeps the existing ones', () => {
      const buffer = new RingBuffer<number>(3)
      expect(buffer.enqueue(1)).toBe(true)
      expect(buffer.enqueue(2)).toBe(true)
      expect(buffer.enqueue(3)).toBe(true)
      expect(buffer.isFull()).toBe(true)
      expect(buffer.enqueue(4)).toBe(false)
      expect([...buffer]).toEqual([1, 2, 3])
      expect(buffer.size).toBe(3)
    })

    it('accepts items again once a dequeue frees a slot', () => {
      const buffer = new RingBuffer<number>(2)
      buffer.enqueue(1)
      buffer.enqueue(2)
      expect(buffer.enqueue(3)).toBe(false)
      buffer.dequeue()
      expect(buffer.enqueue(3)).toBe(true)
      expect([...buffer]).toEqual([2, 3])
    })

    it('works with capacity 1', () => {
      const buffer = new RingBuffer<number>(1)
      expect(buffer.enqueue(1)).toBe(true)
      expect(buffer.isFull()).toBe(true)
      expect(buffer.enqueue(2)).toBe(false)
      expect(buffer.dequeue()).toBe(1)
      expect(buffer.isEmpty()).toBe(true)
    })
  })

  describe('overwrite mode', () => {
    it('behaves like a normal queue until it is full', () => {
      const log = new RingBuffer<string>(3, 'overwrite')
      log.enqueue('a')
      log.enqueue('b')
      expect([...log]).toEqual(['a', 'b'])
      expect(log.isFull()).toBe(false)
    })

    it('replaces the oldest item when full', () => {
      const log = new RingBuffer<string>(3, 'overwrite')
      for (const entry of ['a', 'b', 'c', 'd', 'e']) {
        expect(log.enqueue(entry)).toBe(true)
      }
      expect([...log]).toEqual(['c', 'd', 'e'])
      expect(log.size).toBe(3)
      expect(log.peek()).toBe('c')
      expect(log.dequeue()).toBe('c')
      expect([...log]).toEqual(['d', 'e'])
    })

    it('keeps only the newest item with capacity 1', () => {
      const log = new RingBuffer<number>(1, 'overwrite')
      log.enqueue(1)
      log.enqueue(2)
      log.enqueue(3)
      expect([...log]).toEqual([3])
    })
  })

  it('clear empties the buffer and it can be reused', () => {
    const buffer = new RingBuffer<number>(2)
    buffer.enqueue(1)
    buffer.enqueue(2)
    buffer.clear()
    expect(buffer.size).toBe(0)
    expect(buffer.peek()).toBeUndefined()
    expect(buffer.enqueue(3)).toBe(true)
    expect([...buffer]).toEqual([3])
  })

  describe('randomized', () => {
    it.each(['drop-tail', 'overwrite'] as const)(
      'matches an array reference in %s mode',
      (mode) => {
        const rng = new Rng(mode === 'drop-tail' ? 1 : 2)
        const capacity = 7
        const buffer = new RingBuffer<number>(capacity, mode)
        const reference: number[] = []
        for (let step = 0; step < 5_000; step++) {
          if (rng.next() < 0.55) {
            const value = rng.int(0, 9)
            let accepted = true
            if (reference.length < capacity) {
              reference.push(value)
            } else if (mode === 'overwrite') {
              reference.shift()
              reference.push(value)
            } else {
              accepted = false
            }
            expect(buffer.enqueue(value)).toBe(accepted)
          } else {
            expect(buffer.dequeue()).toBe(reference.shift())
          }
          expect(buffer.size).toBe(reference.length)
          expect(buffer.isFull()).toBe(reference.length === capacity)
          expect(buffer.peek()).toBe(reference[0])
          expect([...buffer]).toEqual(reference)
        }
      },
    )
  })
})
