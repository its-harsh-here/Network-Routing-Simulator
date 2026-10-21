import type { Point } from '../topology/presets.ts'

/**
 * How far along its link a packet is at `time`, from 0 (transmission starting at `from`) to 1
 * (last bit arriving at `to`). Linear in time and clamped to [0, 1]. Time: O(1).
 */
export function packetProgress(departTime: number, arriveTime: number, time: number): number {
  if (arriveTime <= departTime) return 1
  return Math.min(1, Math.max(0, (time - departTime) / (arriveTime - departTime)))
}

/**
 * The point `progress` of the way from `a` to `b`, nudged `sideOffset` pixels to the right of
 * the direction of travel, so packets going opposite ways along a link do not overlap.
 * Time: O(1).
 */
export function pointAlong(a: Point, b: Point, progress: number, sideOffset = 0): Point {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const length = Math.hypot(dx, dy) || 1
  // (-dy, dx) / length is the unit vector to the right of travel when y points down the screen.
  return {
    x: a.x + dx * progress - (dy / length) * sideOffset,
    y: a.y + dy * progress + (dx / length) * sideOffset,
  }
}
