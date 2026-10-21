import { describe, expect, it } from 'vitest'
import { packetProgress, pointAlong } from '../../src/ui/packets.ts'

describe('packetProgress', () => {
  it('interpolates linearly between depart and arrive time', () => {
    expect(packetProgress(100, 200, 100)).toBe(0)
    expect(packetProgress(100, 200, 125)).toBe(0.25)
    expect(packetProgress(100, 200, 200)).toBe(1)
  })

  it('clamps before departure and after arrival', () => {
    expect(packetProgress(100, 200, 50)).toBe(0)
    expect(packetProgress(100, 200, 300)).toBe(1)
  })

  it('treats a zero-length flight as already arrived', () => {
    expect(packetProgress(100, 100, 100)).toBe(1)
  })
})

describe('pointAlong', () => {
  const a = { x: 0, y: 0 }
  const b = { x: 100, y: 0 }

  it('moves from a to b', () => {
    expect(pointAlong(a, b, 0)).toEqual({ x: 0, y: 0 })
    expect(pointAlong(a, b, 0.5)).toEqual({ x: 50, y: 0 })
    expect(pointAlong(a, b, 1)).toEqual({ x: 100, y: 0 })
  })

  it('offsets to the right of the direction of travel', () => {
    // Travelling right on screen (y points down), the right-hand side is below the line.
    expect(pointAlong(a, b, 0.5, 4)).toEqual({ x: 50, y: 4 })
    // Travelling left, it is above.
    expect(pointAlong(b, a, 0.5, 4)).toEqual({ x: 50, y: -4 })
  })

  it('offsets by exactly sideOffset, at right angles, for any direction', () => {
    const from = { x: 10, y: 20 }
    const to = { x: 70, y: 100 } // a 60-80-100 triangle
    const centre = pointAlong(from, to, 0.3)
    const shifted = pointAlong(from, to, 0.3, 5)
    const dx = shifted.x - centre.x
    const dy = shifted.y - centre.y
    expect(Math.hypot(dx, dy)).toBeCloseTo(5, 12)
    expect(dx * (to.x - from.x) + dy * (to.y - from.y)).toBeCloseTo(0, 9) // perpendicular
  })
})
