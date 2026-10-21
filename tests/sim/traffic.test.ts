import { describe, expect, it } from 'vitest'
import { Rng } from '../../src/sim/rng.ts'
import { interArrivalMs, pickPriority, randomPair } from '../../src/sim/traffic.ts'

describe('interArrivalMs', () => {
  it('averages 1000 / packetsPerSecond milliseconds', () => {
    const rng = new Rng(21)
    const gaps = Array.from({ length: 50_000 }, () => interArrivalMs(rng, 50))
    const mean = gaps.reduce((sum, gap) => sum + gap, 0) / gaps.length
    expect(Math.abs(mean - 20)).toBeLessThan(0.5) // 20 ms expected; 50k samples put it within ~1%
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(0)
  })

  it('rejects a rate that is not positive', () => {
    expect(() => interArrivalMs(new Rng(1), 0)).toThrow(RangeError)
  })
})

describe('randomPair', () => {
  it('never pairs a router with itself, and picks every ordered pair about equally often', () => {
    const rng = new Rng(22)
    const routers = ['A', 'B', 'C', 'D']
    const counts = new Map<string, number>()
    const trials = 60_000
    let selfPairs = 0
    for (let i = 0; i < trials; i++) {
      const { src, dst } = randomPair(rng, routers)
      if (src === dst) selfPairs++
      counts.set(`${src}${dst}`, (counts.get(`${src}${dst}`) ?? 0) + 1)
    }
    expect(selfPairs).toBe(0)
    expect(counts.size).toBe(12) // 4 * 3 ordered pairs
    for (const count of counts.values()) expect(count / trials).toBeCloseTo(1 / 12, 2)
  })

  it('works with exactly two routers and rejects fewer', () => {
    const rng = new Rng(23)
    const { src, dst } = randomPair(rng, ['A', 'B'])
    expect([src, dst].sort()).toEqual(['A', 'B'])
    expect(() => randomPair(rng, ['A'])).toThrow(RangeError)
    expect(() => randomPair(rng, [])).toThrow(RangeError)
  })
})

describe('pickPriority', () => {
  it('picks each priority in proportion to its weight', () => {
    const rng = new Rng(24)
    const counts = { video: 0, web: 0, bulk: 0 }
    const trials = 60_000
    for (let i = 0; i < trials; i++) counts[pickPriority(rng, { video: 1, web: 2, bulk: 1 })]++
    expect(counts.video / trials).toBeCloseTo(0.25, 2)
    expect(counts.web / trials).toBeCloseTo(0.5, 2)
    expect(counts.bulk / trials).toBeCloseTo(0.25, 2)
  })

  it('never picks a priority with weight 0', () => {
    const rng = new Rng(25)
    for (let i = 0; i < 1_000; i++) {
      expect(pickPriority(rng, { video: 0, web: 3, bulk: 0 })).toBe('web')
      expect(pickPriority(rng, { video: 1, web: 0, bulk: 1 })).not.toBe('web')
    }
  })

  it('rejects a mix with no positive weight', () => {
    expect(() => pickPriority(new Rng(26), { video: 0, web: 0, bulk: 0 })).toThrow(RangeError)
  })
})
