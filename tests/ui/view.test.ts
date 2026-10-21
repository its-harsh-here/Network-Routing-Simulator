import { describe, expect, it } from 'vitest'
import { Rng } from '../../src/sim/rng.ts'
import { fitView, panBy, toScreen, toWorld, zoomAt, type View } from '../../src/ui/view.ts'

describe('view', () => {
  it('converts world to screen and back', () => {
    const view: View = { scale: 200, x: 30, y: -10 }
    expect(toScreen(view, { x: 0.5, y: 0.25 })).toEqual({ x: 130, y: 40 })
    expect(toWorld(view, { x: 130, y: 40 })).toEqual({ x: 0.5, y: 0.25 })
  })

  it('fits the points inside the padding, centred, keeping the aspect ratio', () => {
    const points = [
      { x: 0.1, y: 0.1 },
      { x: 0.9, y: 0.1 },
      { x: 0.1, y: 0.5 },
      { x: 0.9, y: 0.5 },
    ]
    const view = fitView(points, 1000, 600, 50)
    // The drawing is 0.8 wide and 0.4 tall: width is the limit, (1000 - 100) / 0.8.
    expect(view.scale).toBeCloseTo(1125, 9)
    const screen = points.map((p) => toScreen(view, p))
    expect(Math.min(...screen.map((p) => p.x))).toBeCloseTo(50, 9)
    expect(Math.max(...screen.map((p) => p.x))).toBeCloseTo(950, 9)
    // Vertically centred: equal space above and below.
    const top = Math.min(...screen.map((p) => p.y))
    const bottom = Math.max(...screen.map((p) => p.y))
    expect(top).toBeCloseTo(600 - bottom, 9)
  })

  it('centres a single point and copes with no points', () => {
    const one = fitView([{ x: 0.3, y: 0.7 }], 400, 200, 20)
    expect(toScreen(one, { x: 0.3, y: 0.7 })).toEqual({ x: 200, y: 100 })
    expect(fitView([], 400, 200, 20)).toEqual({ scale: 1, x: 200, y: 100 })
  })

  it('pans by a screen offset', () => {
    expect(panBy({ scale: 2, x: 5, y: 5 }, 10, -3)).toEqual({ scale: 2, x: 15, y: 2 })
  })

  it('zooms around the anchor and respects the limits', () => {
    const view: View = { scale: 100, x: 20, y: 40 }
    const anchor = { x: 300, y: 250 }
    const zoomed = zoomAt(view, 2, anchor)
    expect(zoomed.scale).toBe(200)
    expect(toWorld(zoomed, anchor).x).toBeCloseTo(toWorld(view, anchor).x, 12)
    expect(toWorld(zoomed, anchor).y).toBeCloseTo(toWorld(view, anchor).y, 12)
    expect(zoomAt(view, 10, anchor, 50, 300).scale).toBe(300)
    expect(zoomAt(view, 0.1, anchor, 50, 300).scale).toBe(50)
  })

  it('keeps the anchor fixed and round-trips points for random views', () => {
    const rng = new Rng(17)
    const problems: string[] = []
    for (let trial = 0; trial < 500; trial++) {
      const view: View = {
        scale: rng.uniform(1, 2_000),
        x: rng.uniform(-500, 500),
        y: rng.uniform(-500, 500),
      }
      const world = { x: rng.uniform(-1, 2), y: rng.uniform(-1, 2) }
      const back = toWorld(view, toScreen(view, world))
      if (Math.hypot(back.x - world.x, back.y - world.y) > 1e-9)
        problems.push(`round trip ${trial}`)

      const anchor = { x: rng.uniform(0, 800), y: rng.uniform(0, 600) }
      const before = toWorld(view, anchor)
      const after = toWorld(zoomAt(view, rng.uniform(0.2, 5), anchor), anchor)
      if (Math.hypot(after.x - before.x, after.y - before.y) > 1e-9)
        problems.push(`anchor ${trial}`)
    }
    expect(problems).toEqual([])
  })
})
