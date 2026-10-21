import { describe, expect, it } from 'vitest'
import { MonotonicDeque, slidingWindowMax } from '../../src/ds/MonotonicDeque.ts'
import { Rng } from '../../src/sim/rng.ts'

/** Reference implementation: takes the max of every window directly, in O(n * k). */
function bruteForceWindowMax(values: number[], windowSize: number): number[] {
  const result: number[] = []
  for (let start = 0; start + windowSize <= values.length; start++) {
    result.push(Math.max(...values.slice(start, start + windowSize)))
  }
  return result
}

describe('slidingWindowMax', () => {
  it('solves the classic example', () => {
    expect(slidingWindowMax([1, 3, -1, -3, 5, 3, 6, 7], 3)).toEqual([3, 3, 5, 5, 6, 7])
  })

  it('returns an empty array for empty input or a window longer than the input', () => {
    expect(slidingWindowMax([], 3)).toEqual([])
    expect(slidingWindowMax([1, 2], 3)).toEqual([])
  })

  it('returns the values unchanged for a window of 1', () => {
    expect(slidingWindowMax([4, 2, 9], 1)).toEqual([4, 2, 9])
  })

  it('returns the overall maximum for a window as long as the input', () => {
    expect(slidingWindowMax([4, 2, 9, 1], 4)).toEqual([9])
  })

  it('handles duplicates and decreasing input', () => {
    expect(slidingWindowMax([5, 5, 5], 2)).toEqual([5, 5])
    expect(slidingWindowMax([9, 7, 5, 3], 2)).toEqual([9, 7, 5])
  })

  it('rejects a window size that is not a positive integer', () => {
    for (const size of [0, -2, 1.5, NaN]) {
      expect(() => slidingWindowMax([1, 2, 3], size)).toThrow(RangeError)
    }
  })

  it('matches a brute-force reference on random input', () => {
    const rng = new Rng(2024)
    for (let trial = 0; trial < 300; trial++) {
      const length = rng.randomInt(0, 60)
      const values = Array.from({ length }, () => rng.randomInt(0, 9))
      const windowSize = rng.randomInt(1, length + 2)
      expect(slidingWindowMax(values, windowSize)).toEqual(bruteForceWindowMax(values, windowSize))
    }
  })
})

describe('MonotonicDeque', () => {
  const ascending = (a: number, b: number) => a - b

  it('starts empty', () => {
    const window = new MonotonicDeque(ascending)
    expect(window.size).toBe(0)
    expect(window.max()).toBeUndefined()
  })

  it('reports the maximum of the values still in the window', () => {
    const window = new MonotonicDeque(ascending)
    window.push(0, 2)
    window.push(1, 8)
    window.push(2, 5)
    expect(window.max()).toBe(8)
    window.evictBefore(2) // keys 0 and 1 leave the window
    expect(window.max()).toBe(5)
  })

  it('drops values that can never be the maximum', () => {
    const window = new MonotonicDeque(ascending)
    window.push(0, 1)
    window.push(1, 2)
    window.push(2, 3)
    expect(window.size).toBe(1)
    expect(window.max()).toBe(3)
  })

  it('keeps only the newest of equal values, since it stays in the window longest', () => {
    const window = new MonotonicDeque(ascending)
    window.push(0, 5)
    window.push(1, 5)
    expect(window.size).toBe(1)
    window.evictBefore(1)
    expect(window.max()).toBe(5)
  })

  it('works with timestamps as keys', () => {
    const window = new MonotonicDeque(ascending)
    window.push(0.5, 3)
    window.push(1.2, 7)
    window.push(2.0, 4)
    window.evictBefore(1.5)
    expect(window.max()).toBe(4)
  })

  it('accepts repeated keys but rejects keys that go backwards', () => {
    const window = new MonotonicDeque(ascending)
    window.push(5, 1)
    window.push(5, 2)
    expect(() => window.push(4, 3)).toThrow(RangeError)
  })

  it('gives a sliding minimum with a reversed comparator', () => {
    const window = new MonotonicDeque<number>((a, b) => b - a)
    window.push(0, 4)
    window.push(1, 1)
    window.push(2, 6)
    expect(window.max()).toBe(1)
    window.evictBefore(2)
    expect(window.max()).toBe(6)
  })

  it('is empty after evicting everything, and clear resets the key check', () => {
    const window = new MonotonicDeque(ascending)
    window.push(10, 1)
    window.evictBefore(11)
    expect(window.size).toBe(0)
    expect(window.max()).toBeUndefined()

    window.clear()
    window.push(0, 5) // allowed again after clear
    expect(window.max()).toBe(5)
  })
})
