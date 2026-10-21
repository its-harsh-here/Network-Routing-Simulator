import type { ProtocolName } from '../routing/types.ts'
import type { Priority } from '../sim/Packet.ts'

type Rgb = readonly [number, number, number]

/** Colour scale for link utilisation, at 0%, 50% and 100%: slate, amber, red. */
export const UTILISATION_STOPS: readonly Rgb[] = [
  [71, 85, 105],
  [245, 158, 11],
  [239, 68, 68],
]

/** Colour scale for how full a router's queues are, at 0%, 50% and 100%: green, yellow, red. */
export const QUEUE_FILL_STOPS: readonly Rgb[] = [
  [34, 197, 94],
  [234, 179, 8],
  [239, 68, 68],
]

/** Packet dot colour for each traffic class. */
export const PRIORITY_COLORS: Readonly<Record<Priority, string>> = {
  video: '#f472b6',
  web: '#38bdf8',
  bulk: '#e2e8f0',
}

/** Colour of each protocol in the comparison table and chart. */
export const PROTOCOL_COLORS: Readonly<Record<ProtocolName, string>> = {
  'link-state': '#38bdf8',
  'distance-vector': '#f59e0b',
}

/** Colour of routing control messages (LSAs and distance-vector updates) on the map. */
export const CONTROL_MESSAGE_COLOR = '#a3e635'

/** Colour and dash pattern for a link that is down. */
export const DOWN_LINK_COLOR = '#6b7280'
export const DOWN_LINK_DASH: readonly number[] = [6, 5]

/** Clamps `value` to [0, 1]. Time: O(1). */
export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value))
}

/**
 * The colour at position `t` (0 to 1) along a scale of evenly spaced stops, mixing the two
 * nearest stops in proportion. Returns a CSS rgb() string. Time: O(1) for a fixed scale.
 */
export function colorOnScale(stops: readonly Rgb[], t: number): string {
  const position = clamp01(t) * (stops.length - 1)
  const lower = Math.min(Math.floor(position), stops.length - 2)
  const mix = position - lower
  const [r, g, b] = stops[lower].map((channel, i) =>
    Math.round(channel + (stops[lower + 1][i] - channel) * mix),
  )
  return `rgb(${r}, ${g}, ${b})`
}

/** CSS linear-gradient() for a scale, for drawing it in the legend. Time: O(stops). */
export function gradientCss(stops: readonly Rgb[]): string {
  return `linear-gradient(to right, ${stops.map(([r, g, b]) => `rgb(${r}, ${g}, ${b})`).join(', ')})`
}

/**
 * Line width in CSS pixels for a link with utilisation `u`: 2 px idle, up to 8 px when full.
 * Time: O(1).
 */
export function linkWidth(u: number): number {
  return 2 + 6 * clamp01(u)
}
