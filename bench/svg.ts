// SVG charts for the benchmark report, written by hand (no chart library). White background so
// they read well in light and dark mode alike.

const FONT = 'font-family="system-ui, -apple-system, Segoe UI, sans-serif"'
const TEXT = '#1e293b'
const MUTED = '#64748b'
const GRID = '#e2e8f0'

export interface Series {
  name: string
  colour: string
  points: { x: number; y: number }[]
}

/** Escapes text for use inside SVG. */
function esc(text: string): string {
  return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

/** "100", "1k", "20k", "1.5M". */
export function shortNumber(value: number): string {
  if (value >= 1e6) return `${+(value / 1e6).toFixed(1)}M`
  if (value >= 1e3) return `${+(value / 1e3).toFixed(1)}k`
  return `${+value.toPrecision(3)}`
}

/** The smallest of 1, 2, 5 times a power of ten that is at least `value`. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  for (const step of [1, 2, 5, 10]) if (step * power >= value) return step * power
  return 10 * power
}

/**
 * A line chart with logarithmic x and y axes: equal ratios get equal distances, so O(V log V)
 * and O(V^2) show up as straight lines of different slopes. X ticks are at the data's x values;
 * y grid lines are at powers of ten.
 */
export function logLogLineChart(opts: {
  title: string
  xLabel: string
  yLabel: string
  yUnit: string
  series: Series[]
}): string {
  const width = 720
  const height = 420
  const margin = { left: 78, right: 170, top: 46, bottom: 58 }
  const plotW = width - margin.left - margin.right
  const plotH = height - margin.top - margin.bottom
  const all = opts.series.flatMap((s) => s.points)
  const xs = [...new Set(all.map((p) => p.x))].sort((a, b) => a - b)
  const [xMin, xMax] = [Math.log10(xs[0]), Math.log10(xs[xs.length - 1])]
  const yLow = Math.floor(Math.log10(Math.min(...all.map((p) => p.y))))
  const yHigh = Math.ceil(Math.log10(Math.max(...all.map((p) => p.y))))
  const xPos = (x: number) =>
    margin.left + (xMax === xMin ? plotW / 2 : ((Math.log10(x) - xMin) / (xMax - xMin)) * plotW)
  const yPos = (y: number) =>
    margin.top + plotH - ((Math.log10(y) - yLow) / Math.max(yHigh - yLow, 1)) * plotH

  const parts: string[] = []
  for (let k = yLow; k <= yHigh; k++) {
    const y = yPos(10 ** k)
    parts.push(
      `<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotW}" y2="${y}" stroke="${GRID}"/>`,
    )
    parts.push(
      `<text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="${MUTED}">${esc(shortNumber(10 ** k))}${esc(opts.yUnit)}</text>`,
    )
  }
  for (const x of xs) {
    const px = xPos(x)
    parts.push(
      `<line x1="${px}" y1="${margin.top}" x2="${px}" y2="${margin.top + plotH}" stroke="${GRID}"/>`,
    )
    parts.push(
      `<text x="${px}" y="${margin.top + plotH + 18}" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(shortNumber(x))}</text>`,
    )
  }
  opts.series.forEach((s, i) => {
    const points = s.points.map((p) => `${xPos(p.x).toFixed(1)},${yPos(p.y).toFixed(1)}`).join(' ')
    parts.push(`<polyline points="${points}" fill="none" stroke="${s.colour}" stroke-width="2.5"/>`)
    for (const p of s.points) {
      parts.push(
        `<circle cx="${xPos(p.x).toFixed(1)}" cy="${yPos(p.y).toFixed(1)}" r="4" fill="${s.colour}"><title>${esc(`${s.name}: ${shortNumber(p.x)} -> ${p.y} ${opts.yUnit.trim()}`)}</title></circle>`,
      )
    }
    const ly = margin.top + 20 + i * 22
    parts.push(
      `<line x1="${margin.left + plotW + 18}" y1="${ly}" x2="${margin.left + plotW + 40}" y2="${ly}" stroke="${s.colour}" stroke-width="3"/>`,
    )
    parts.push(
      `<text x="${margin.left + plotW + 46}" y="${ly + 4}" font-size="12" fill="${TEXT}">${esc(s.name)}</text>`,
    )
  })
  parts.push(
    `<rect x="${margin.left}" y="${margin.top}" width="${plotW}" height="${plotH}" fill="none" stroke="${MUTED}"/>`,
  )
  parts.push(
    `<text x="${margin.left}" y="26" font-size="15" font-weight="600" fill="${TEXT}">${esc(opts.title)}</text>`,
  )
  parts.push(
    `<text x="${margin.left + plotW / 2}" y="${height - 14}" text-anchor="middle" font-size="12" fill="${TEXT}">${esc(opts.xLabel)}</text>`,
  )
  parts.push(
    `<text transform="translate(18 ${margin.top + plotH / 2}) rotate(-90)" text-anchor="middle" font-size="12" fill="${TEXT}">${esc(opts.yLabel)}</text>`,
  )
  return svgDocument(width, height, parts)
}

/**
 * Side-by-side panels of grouped bars: in each panel, one group per category (say, a topology)
 * and one bar per series (say, a protocol), each panel with its own scale. Values are printed
 * on the bars.
 */
export function groupedBarPanels(opts: {
  title: string
  groups: string[]
  series: { name: string; colour: string }[]
  panels: { title: string; values: number[][] }[]
}): string {
  const panelW = 300
  const width = opts.panels.length * panelW + 40
  const height = 360
  const top = 84
  const bottom = 300
  const parts: string[] = []
  parts.push(
    `<text x="20" y="26" font-size="15" font-weight="600" fill="${TEXT}">${esc(opts.title)}</text>`,
  )
  opts.series.forEach((s, i) => {
    const x = 20 + i * 190
    parts.push(`<rect x="${x}" y="40" width="14" height="14" fill="${s.colour}"/>`)
    parts.push(`<text x="${x + 20}" y="52" font-size="12" fill="${TEXT}">${esc(s.name)}</text>`)
  })
  opts.panels.forEach((panel, p) => {
    const left = 20 + p * panelW + 44
    const plotW = panelW - 64
    const max = niceCeil(Math.max(...panel.values.flat(), 0))
    const yPos = (v: number) => bottom - (v / max) * (bottom - top)
    parts.push(
      `<text x="${left + plotW / 2}" y="${top - 12}" text-anchor="middle" font-size="13" font-weight="600" fill="${TEXT}">${esc(panel.title)}</text>`,
    )
    for (let i = 0; i <= 4; i++) {
      const v = (max * i) / 4
      const y = yPos(v)
      parts.push(`<line x1="${left}" y1="${y}" x2="${left + plotW}" y2="${y}" stroke="${GRID}"/>`)
      parts.push(
        `<text x="${left - 6}" y="${y + 4}" text-anchor="end" font-size="10" fill="${MUTED}">${esc(shortNumber(v))}</text>`,
      )
    }
    const groupW = plotW / opts.groups.length
    const barW = (groupW - 14) / opts.series.length
    opts.groups.forEach((group, g) => {
      const gx = left + g * groupW + 7
      opts.series.forEach((s, i) => {
        const value = panel.values[g][i]
        const y = yPos(value)
        const x = gx + i * barW
        parts.push(
          `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${(barW - 2).toFixed(1)}" height="${(bottom - y).toFixed(1)}" fill="${s.colour}"><title>${esc(`${group}, ${s.name}: ${value}`)}</title></rect>`,
        )
        parts.push(
          `<text x="${(x + (barW - 2) / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="9" fill="${TEXT}">${esc(shortNumber(value))}</text>`,
        )
      })
      parts.push(
        `<text x="${(gx + (groupW - 14) / 2).toFixed(1)}" y="${bottom + 16}" text-anchor="middle" font-size="11" fill="${MUTED}">${esc(group)}</text>`,
      )
    })
    parts.push(
      `<line x1="${left}" y1="${bottom}" x2="${left + plotW}" y2="${bottom}" stroke="${MUTED}"/>`,
    )
  })
  return svgDocument(width, height, parts)
}

function svgDocument(width: number, height: number, parts: string[]): string {
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${FONT}>`,
    `<rect width="${width}" height="${height}" fill="#ffffff"/>`,
    ...parts,
    '</svg>',
    '',
  ].join('\n')
}
