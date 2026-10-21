import { describe, expect, it } from 'vitest'
import { sparklinePath } from '../../src/ui/sparkline.ts'

describe('sparklinePath', () => {
  it('draws values left to right, scaled from the floor to the maximum', () => {
    // Floor 0, max 10: 0 at the bottom (y = 20), 10 at the top (y = 0).
    expect(sparklinePath([0, 5, 10], 100, 20)).toBe('M0.0 20.0 L50.0 10.0 L100.0 0.0')
  })

  it('lifts the pen over missing values', () => {
    expect(sparklinePath([10, null, 10], 100, 20)).toBe('M0.0 0.0 M100.0 0.0')
  })

  it('draws nothing when there is nothing to draw', () => {
    expect(sparklinePath([], 100, 20)).toBe('')
    expect(sparklinePath([null, null], 100, 20)).toBe('')
  })

  it('uses a higher floor to magnify small dips', () => {
    // Floor 90: a dip from 100 to 95 reaches halfway down instead of 5%.
    expect(sparklinePath([100, 95, 100], 100, 20, 90)).toBe('M0.0 0.0 L50.0 10.0 L100.0 0.0')
    // Values below the floor still fit: the scale stretches down to them.
    expect(sparklinePath([100, 80], 100, 20, 90)).toBe('M0.0 0.0 L100.0 20.0')
  })

  it('puts a flat line at the bottom and a single point at the left', () => {
    expect(sparklinePath([0, 0, 0], 100, 20)).toBe('M0.0 20.0 L50.0 20.0 L100.0 20.0')
    expect(sparklinePath([4], 100, 20)).toBe('M0.0 0.0')
  })
})
