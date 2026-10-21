import { describe, expect, it } from 'vitest'
import { Rng } from '../../src/sim/rng.ts'

describe('Rng', () => {
  it('gives the same sequence for the same seed', () => {
    const first = new Rng(123)
    const second = new Rng(123)
    for (let i = 0; i < 100; i++) expect(first.uniform()).toBe(second.uniform())
  })

  it('gives different sequences for different seeds', () => {
    const firstFive = (seed: number) => {
      const rng = new Rng(seed)
      return Array.from({ length: 5 }, () => rng.uniform())
    }
    expect(firstFive(1)).not.toEqual(firstFive(2))
  })

  describe('uniform', () => {
    it('stays in [0, 1) by default', () => {
      const rng = new Rng(5)
      const values = Array.from({ length: 10_000 }, () => rng.uniform())
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...values)).toBeLessThan(1)
    })

    it('stays in [min, max) and averages to the midpoint', () => {
      const rng = new Rng(6)
      const values = Array.from({ length: 10_000 }, () => rng.uniform(10, 20))
      expect(Math.min(...values)).toBeGreaterThanOrEqual(10)
      expect(Math.max(...values)).toBeLessThan(20)
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length
      expect(mean).toBeCloseTo(15, 0)
    })

    it('returns min when min equals max, and rejects min > max', () => {
      const rng = new Rng(7)
      expect(rng.uniform(3, 3)).toBe(3)
      expect(() => rng.uniform(2, 1)).toThrow(RangeError)
      expect(() => rng.uniform(0, Infinity)).toThrow(RangeError)
    })
  })

  describe('randomInt', () => {
    it('stays in [min, max] and reaches both ends', () => {
      const rng = new Rng(8)
      const seen = new Set<number>()
      for (let i = 0; i < 1_000; i++) seen.add(rng.randomInt(-2, 2))
      expect([...seen].sort((x, y) => x - y)).toEqual([-2, -1, 0, 1, 2])
    })

    it('rejects non-integers and min > max', () => {
      const rng = new Rng(0)
      expect(() => rng.randomInt(0.5, 2)).toThrow(RangeError)
      expect(() => rng.randomInt(3, 1)).toThrow(RangeError)
      expect(rng.randomInt(4, 4)).toBe(4)
    })
  })

  describe('pick', () => {
    it('returns every item with roughly equal frequency', () => {
      const rng = new Rng(9)
      const counts = new Map<string, number>()
      for (let i = 0; i < 30_000; i++) {
        const item = rng.pick(['a', 'b', 'c'])
        counts.set(item, (counts.get(item) ?? 0) + 1)
      }
      for (const item of ['a', 'b', 'c']) {
        expect((counts.get(item) as number) / 30_000).toBeCloseTo(1 / 3, 1)
      }
    })

    it('returns the only item of a one-item list, and rejects an empty list', () => {
      const rng = new Rng(10)
      expect(rng.pick(['only'])).toBe('only')
      expect(() => rng.pick([])).toThrow(RangeError)
    })
  })

  describe('exponential', () => {
    it('is never negative and has mean 1 / rate', () => {
      const rng = new Rng(11)
      const rate = 0.25
      const values = Array.from({ length: 50_000 }, () => rng.exponential(rate))
      expect(Math.min(...values)).toBeGreaterThanOrEqual(0)
      const mean = values.reduce((sum, v) => sum + v, 0) / values.length
      // 50,000 samples put the sample mean within about 1% of the true mean of 4.
      expect(Math.abs(mean - 1 / rate)).toBeLessThan(0.1)
    })

    it('matches the exponential distribution: P(X > mean) = 1/e', () => {
      const rng = new Rng(12)
      const above = Array.from({ length: 50_000 }, () => rng.exponential(2)).filter(
        (v) => v > 0.5,
      ).length
      expect(above / 50_000).toBeCloseTo(Math.exp(-1), 2)
    })

    it('rejects a rate that is not positive', () => {
      const rng = new Rng(13)
      for (const rate of [0, -1, NaN, Infinity]) {
        expect(() => rng.exponential(rate)).toThrow(RangeError)
      }
    })
  })
})
