/**
 * SVG path data for a sparkline of `values` drawn in a width x height box, left to right.
 * The vertical scale runs from `floor` (or the smallest value, if lower) to the largest value,
 * so a flat line sits at the bottom rather than jumping around. Null values leave a gap: the
 * line lifts the pen ("M") and starts again after them. Returns "" if there is nothing to draw.
 * Time: O(n).
 */
export function sparklinePath(
  values: readonly (number | null)[],
  width: number,
  height: number,
  floor = 0,
): string {
  const present = values.filter((v): v is number => v !== null)
  if (present.length === 0) return ''
  const low = Math.min(floor, ...present)
  const high = Math.max(...present)
  const range = high - low || 1
  const step = values.length > 1 ? width / (values.length - 1) : 0

  let path = ''
  let penDown = false
  values.forEach((value, i) => {
    if (value === null) {
      penDown = false
      return
    }
    const x = i * step
    const y = height - ((value - low) / range) * height
    path += `${penDown ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)} `
    penDown = true
  })
  return path.trim()
}
