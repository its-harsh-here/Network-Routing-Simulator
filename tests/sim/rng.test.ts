import { describe, expect, it } from 'vitest'
import { Rng } from '../../src/sim/rng.ts'

describe('Rng', () => {
  it('gives the same sequence for the same seed', () => {
    const first = new Rng(123)
    const second = new Rng(123)
    for (let i = 0; i < 100; i++) expect(first.next()).toBe(second.next())
  })

  it('gives different sequences for different seeds', () => {
    const firstFive = (seed: number) => {
      const rng = new Rng(seed)
      return Array.from({ length: 5 }, () => rng.next())
    }
    expect(firstFive(1)).not.toEqual(firstFive(2))
  })

  it('next stays in [0, 1)', () => {
    const rng = new Rng(5)
    for (let i = 0; i < 10_000; i++) {
      const value = rng.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('int stays in [min, max] and reaches both ends', () => {
    const rng = new Rng(8)
    const seen = new Set<number>()
    for (let i = 0; i < 1_000; i++) {
      const value = rng.int(-2, 2)
      expect(value).toBeGreaterThanOrEqual(-2)
      expect(value).toBeLessThanOrEqual(2)
      seen.add(value)
    }
    expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2])
  })

  it('int rejects non-integers and min > max', () => {
    const rng = new Rng(0)
    expect(() => rng.int(0.5, 2)).toThrow(RangeError)
    expect(() => rng.int(3, 1)).toThrow(RangeError)
    expect(rng.int(4, 4)).toBe(4)
  })
})
