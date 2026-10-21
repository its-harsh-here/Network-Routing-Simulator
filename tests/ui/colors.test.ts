import { describe, expect, it } from 'vitest'
import {
  clamp01,
  colorOnScale,
  gradientCss,
  linkWidth,
  QUEUE_FILL_STOPS,
  UTILISATION_STOPS,
} from '../../src/ui/colors.ts'

describe('colours', () => {
  it('returns the stop colours at the ends and the middle of a scale', () => {
    expect(colorOnScale(QUEUE_FILL_STOPS, 0)).toBe('rgb(34, 197, 94)') // green
    expect(colorOnScale(QUEUE_FILL_STOPS, 0.5)).toBe('rgb(234, 179, 8)') // yellow
    expect(colorOnScale(QUEUE_FILL_STOPS, 1)).toBe('rgb(239, 68, 68)') // red
  })

  it('mixes neighbouring stops in between', () => {
    // A quarter of the way: halfway from green to yellow.
    expect(colorOnScale(QUEUE_FILL_STOPS, 0.25)).toBe('rgb(134, 188, 51)')
  })

  it('clamps values outside [0, 1]', () => {
    expect(colorOnScale(UTILISATION_STOPS, -1)).toBe(colorOnScale(UTILISATION_STOPS, 0))
    expect(colorOnScale(UTILISATION_STOPS, 7)).toBe(colorOnScale(UTILISATION_STOPS, 1))
    expect(clamp01(0.3)).toBe(0.3)
  })

  it('makes busier links thicker, from 2 to 8 pixels', () => {
    expect(linkWidth(0)).toBe(2)
    expect(linkWidth(0.5)).toBe(5)
    expect(linkWidth(1)).toBe(8)
    expect(linkWidth(3)).toBe(8)
  })

  it('builds a CSS gradient for the legend', () => {
    expect(gradientCss(QUEUE_FILL_STOPS)).toBe(
      'linear-gradient(to right, rgb(34, 197, 94), rgb(234, 179, 8), rgb(239, 68, 68))',
    )
  })
})
