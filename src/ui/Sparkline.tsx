import { sparklinePath } from './sparkline.ts'

interface Props {
  values: readonly (number | null)[]
  color: string
  /** The vertical scale always reaches down to at least this value. */
  floor?: number
}

/**
 * A tiny line chart drawn as SVG. No chart library needed for a single line.
 * Render: O(n) for n values.
 */
export default function Sparkline({ values, color, floor = 0 }: Props) {
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className="mt-1 h-6 w-full" aria-hidden>
      <path
        d={sparklinePath(values, 100, 24, floor)}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}
