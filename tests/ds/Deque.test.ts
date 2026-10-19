import { describe, expect, it } from 'vitest'
import { Deque } from '../../src/ds/Deque.ts'
import { Rng } from '../../src/sim/rng.ts'

describe('Deque', () => {
  it('starts empty', () => {
    const deque = new Deque<number>()
    expect(deque.size).toBe(0)
    expect(deque.isEmpty()).toBe(true)
    expect(deque.peekFront()).toBeUndefined()
    expect(deque.peekBack()).toBeUndefined()
    expect(deque.popFront()).toBeUndefined()
    expect(deque.popBack()).toBeUndefined()
    expect([...deque]).toEqual([])
  })

  it('works as a queue: pushBack then popFront', () => {
    const deque = new Deque<number>()
    for (const n of [1, 2, 3]) deque.pushBack(n)
    expect(deque.popFront()).toBe(1)
    expect(deque.popFront()).toBe(2)
    expect(deque.popFront()).toBe(3)
    expect(deque.popFront()).toBeUndefined()
  })

  it('works as a stack: pushBack then popBack', () => {
    const deque = new Deque<number>()
    for (const n of [1, 2, 3]) deque.pushBack(n)
    expect(deque.popBack()).toBe(3)
    expect(deque.popBack()).toBe(2)
    expect(deque.popBack()).toBe(1)
    expect(deque.popBack()).toBeUndefined()
  })

  it('pushFront adds items at the front', () => {
    const deque = new Deque<number>()
    for (const n of [1, 2, 3]) deque.pushFront(n)
    expect([...deque]).toEqual([3, 2, 1])
  })

  it('peeks at both ends without removing anything', () => {
    const deque = new Deque<string>()
    deque.pushBack('middle')
    deque.pushFront('front')
    deque.pushBack('back')
    expect(deque.peekFront()).toBe('front')
    expect(deque.peekBack()).toBe('back')
    expect(deque.size).toBe(3)
  })

  it('handles a single item from either end', () => {
    const deque = new Deque<number>()
    deque.pushFront(1)
    expect(deque.peekFront()).toBe(1)
    expect(deque.peekBack()).toBe(1)
    expect(deque.popBack()).toBe(1)
    expect(deque.isEmpty()).toBe(true)

    deque.pushBack(2)
    expect(deque.popFront()).toBe(2)
    expect(deque.isEmpty()).toBe(true)
  })

  it('keeps duplicates', () => {
    const deque = new Deque<number>()
    deque.pushBack(4)
    deque.pushBack(4)
    deque.pushFront(4)
    expect([...deque]).toEqual([4, 4, 4])
  })

  it('grows past its initial capacity while wrapped around the end of the array', () => {
    const deque = new Deque<number>()
    // pushFront first, so the front wraps to the end of the array before the deque grows.
    for (let i = 1; i <= 5; i++) deque.pushFront(-i)
    for (let i = 1; i <= 20; i++) deque.pushBack(i)
    const expected = [-5, -4, -3, -2, -1, ...Array.from({ length: 20 }, (_, i) => i + 1)]
    expect([...deque]).toEqual(expected)
    expect(deque.size).toBe(25)
    expect(deque.peekFront()).toBe(-5)
    expect(deque.peekBack()).toBe(20)
  })

  it('clear empties the deque and it can be reused', () => {
    const deque = new Deque<number>()
    for (let i = 0; i < 20; i++) deque.pushBack(i)
    deque.clear()
    expect(deque.size).toBe(0)
    expect(deque.popFront()).toBeUndefined()
    deque.pushFront(1)
    expect([...deque]).toEqual([1])
  })

  describe('randomized', () => {
    it('matches an array reference under random pushes and pops at both ends', () => {
      const rng = new Rng(99)
      const deque = new Deque<number>()
      const reference: number[] = []
      for (let step = 0; step < 10_000; step++) {
        // Mostly pushes in the first half (so the deque grows several times), mostly pops after.
        const pushChance = step < 5_000 ? 0.7 : 0.3
        const atFront = rng.next() < 0.5
        if (rng.next() < pushChance) {
          const value = rng.int(0, 1000)
          if (atFront) {
            deque.pushFront(value)
            reference.unshift(value)
          } else {
            deque.pushBack(value)
            reference.push(value)
          }
        } else if (atFront) {
          expect(deque.popFront()).toBe(reference.shift())
        } else {
          expect(deque.popBack()).toBe(reference.pop())
        }
        expect(deque.size).toBe(reference.length)
        expect(deque.peekFront()).toBe(reference[0])
        expect(deque.peekBack()).toBe(reference[reference.length - 1])
        if (step % 500 === 0) expect([...deque]).toEqual(reference)
      }
      expect([...deque]).toEqual(reference)
    })
  })
})
