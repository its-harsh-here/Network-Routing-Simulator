import { describe, expect, it } from 'vitest'
import { Rng } from '../../src/sim/rng.ts'
import { distanceToSegment, hitTest, type LinkSegment } from '../../src/ui/hitTest.ts'

describe('distanceToSegment', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 10, y: 0 }

  it('measures straight to the segment when the point is beside it', () => {
    expect(distanceToSegment({ x: 4, y: 3 }, a, b)).toBe(3)
  })

  it('measures to the nearest end when the point is beyond it', () => {
    expect(distanceToSegment({ x: -3, y: 4 }, a, b)).toBe(5)
    expect(distanceToSegment({ x: 13, y: -4 }, a, b)).toBe(5)
  })

  it('handles a segment of zero length', () => {
    expect(distanceToSegment({ x: 3, y: 4 }, a, a)).toBe(5)
  })

  it('matches a brute-force reference that samples points along the segment', () => {
    const rng = new Rng(5)
    const problems: string[] = []
    for (let trial = 0; trial < 300; trial++) {
      const p = { x: rng.uniform(-50, 50), y: rng.uniform(-50, 50) }
      const s = { x: rng.uniform(-50, 50), y: rng.uniform(-50, 50) }
      const e = { x: rng.uniform(-50, 50), y: rng.uniform(-50, 50) }
      let best = Infinity
      for (let i = 0; i <= 2_000; i++) {
        const t = i / 2_000
        best = Math.min(
          best,
          Math.hypot(p.x - (s.x + t * (e.x - s.x)), p.y - (s.y + t * (e.y - s.y))),
        )
      }
      const got = distanceToSegment(p, s, e)
      // Sampling can only overestimate, by at most half the gap between samples.
      if (got > best + 1e-9 || best - got > 0.06) problems.push(`trial ${trial}: ${got} vs ${best}`)
    }
    expect(problems).toEqual([])
  })
})

describe('hitTest', () => {
  const routers = new Map([
    ['A', { x: 0, y: 0 }],
    ['B', { x: 100, y: 0 }],
  ])
  const links: LinkSegment[] = [{ id: 'ab', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } }]

  it('finds a router under the pointer', () => {
    expect(hitTest({ x: 98, y: 5 }, routers, links, 16, 6)).toEqual({ kind: 'router', id: 'B' })
  })

  it('prefers a router over the link it sits on', () => {
    expect(hitTest({ x: 10, y: 0 }, routers, links, 16, 6)).toEqual({ kind: 'router', id: 'A' })
  })

  it('finds a link near the pointer', () => {
    expect(hitTest({ x: 50, y: 5 }, routers, links, 16, 6)).toEqual({ kind: 'link', id: 'ab' })
  })

  it('finds nothing in empty space', () => {
    expect(hitTest({ x: 50, y: 30 }, routers, links, 16, 6)).toBeNull()
  })

  it('finds a packet before the link it is on, but not before a router', () => {
    const dots = [
      { id: 7, point: { x: 50, y: 4 } },
      { id: 8, point: { x: 60, y: 4 } },
    ]
    expect(hitTest({ x: 53, y: 4 }, routers, links, 16, 6, dots, 9)).toEqual({
      kind: 'packet',
      id: 7,
    })
    expect(hitTest({ x: 57, y: 4 }, routers, links, 16, 6, dots, 9)).toEqual({
      kind: 'packet',
      id: 8,
    })
    expect(hitTest({ x: 30, y: 4 }, routers, links, 16, 6, dots, 9)).toEqual({
      kind: 'link',
      id: 'ab',
    })
    const onRouter = [{ id: 9, point: { x: 99, y: 0 } }]
    expect(hitTest({ x: 99, y: 0 }, routers, links, 16, 6, onRouter, 9)).toEqual({
      kind: 'router',
      id: 'B',
    })
  })

  it('picks the nearest of two close links', () => {
    const two: LinkSegment[] = [
      { id: 'low', a: { x: 0, y: 10 }, b: { x: 100, y: 10 } },
      { id: 'high', a: { x: 0, y: 14 }, b: { x: 100, y: 14 } },
    ]
    expect(hitTest({ x: 50, y: 13 }, new Map(), two, 16, 6)).toEqual({ kind: 'link', id: 'high' })
  })
})
