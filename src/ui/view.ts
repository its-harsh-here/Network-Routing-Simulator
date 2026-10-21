import type { Point } from '../topology/presets.ts'

/**
 * Maps world coordinates (topology positions, 0 to 1) to screen pixels:
 * screen = world * scale + (x, y). Panning changes x and y; zooming changes all three.
 */
export interface View {
  scale: number
  x: number
  y: number
}

/** Converts a world point to screen pixels. Time: O(1). */
export function toScreen(view: View, point: Point): Point {
  return { x: point.x * view.scale + view.x, y: point.y * view.scale + view.y }
}

/** Converts a screen point back to world coordinates. Time: O(1). */
export function toWorld(view: View, point: Point): Point {
  return { x: (point.x - view.x) / view.scale, y: (point.y - view.y) / view.scale }
}

/**
 * The view that fits all `points` into a width x height canvas with `padding` pixels on every
 * side, keeping the aspect ratio and centring the drawing. Time: O(n).
 */
export function fitView(
  points: readonly Point[],
  width: number,
  height: number,
  padding: number,
): View {
  if (points.length === 0) return { scale: 1, x: width / 2, y: height / 2 }
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const { x, y } of points) {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x)
    maxY = Math.max(maxY, y)
  }
  // A single point, or points in a line, have zero extent in some direction; treat it as 1.
  const worldWidth = maxX - minX || 1
  const worldHeight = maxY - minY || 1
  const usableWidth = Math.max(width - 2 * padding, 1)
  const usableHeight = Math.max(height - 2 * padding, 1)
  const scale = Math.min(usableWidth / worldWidth, usableHeight / worldHeight)
  // Centre the drawing: the middle of the bounding box goes to the middle of the canvas.
  return {
    scale,
    x: width / 2 - ((minX + maxX) / 2) * scale,
    y: height / 2 - ((minY + maxY) / 2) * scale,
  }
}

/** Moves the drawing by (dx, dy) screen pixels. Time: O(1). */
export function panBy(view: View, dx: number, dy: number): View {
  return { scale: view.scale, x: view.x + dx, y: view.y + dy }
}

/**
 * Zooms by `factor` around the screen point `anchor`, so the world point under the cursor stays
 * under the cursor. The scale is kept within [minScale, maxScale]. Time: O(1).
 */
export function zoomAt(
  view: View,
  factor: number,
  anchor: Point,
  minScale = 0,
  maxScale = Infinity,
): View {
  const scale = Math.min(Math.max(view.scale * factor, minScale), maxScale)
  const applied = scale / view.scale
  return {
    scale,
    x: anchor.x - (anchor.x - view.x) * applied,
    y: anchor.y - (anchor.y - view.y) * applied,
  }
}
