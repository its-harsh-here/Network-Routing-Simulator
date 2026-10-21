// Helpers shared by the benchmarks: timing, medians, random graphs, CSV.
import { cpus, platform, release } from 'node:os'
import { Graph } from '../src/ds/Graph.ts'
import { Rng } from '../src/sim/rng.ts'

/** Link costs in the random graphs are uniform in [COST_RANGE[0], COST_RANGE[1]). */
export const COST_RANGE = [1, 10] as const

/** The middle value (the mean of the two middle values for an even count). Time: O(n log n). */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new RangeError('median of no values')
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/** Runs `work` once and returns how long it took, in ms. */
export function timeMs(work: () => void): number {
  const start = performance.now()
  work()
  return performance.now() - start
}

/**
 * A random connected graph with V nodes and about `averageDegree` * V / 2 links: first a random
 * tree (node i joins a random earlier node), so it is connected, then random extra links until
 * the link count is reached. Costs are uniform in COST_RANGE. The same rng state gives the same
 * graph. Time: O(V + E) expected (an extra link is redrawn if it would repeat one).
 * @throws RangeError if V < 1 or the degree asks for more links than a simple graph can have.
 */
export function randomConnectedGraph(rng: Rng, nodes: number, averageDegree: number): Graph {
  if (!Number.isInteger(nodes) || nodes < 1)
    throw new RangeError(`need at least one node, got ${nodes}`)
  const links = Math.round((averageDegree * nodes) / 2)
  const maxLinks = (nodes * (nodes - 1)) / 2
  if (links < nodes - 1 || links > maxLinks) {
    throw new RangeError(`average degree ${averageDegree} does not fit ${nodes} nodes`)
  }
  const graph = new Graph()
  for (let i = 0; i < nodes; i++) graph.addNode(`n${i}`)
  const link = (a: number, b: number) =>
    graph.addEdge(`n${a}`, `n${b}`, { cost: rng.uniform(COST_RANGE[0], COST_RANGE[1]) })
  for (let i = 1; i < nodes; i++) link(i, rng.randomInt(0, i - 1))
  while (graph.edgeCount < links) {
    const a = rng.randomInt(0, nodes - 1)
    const b = rng.randomInt(0, nodes - 1)
    if (a !== b && graph.edgeBetween(`n${a}`, `n${b}`) === undefined) link(a, b)
  }
  return graph
}

/** Rows of values as CSV text, with a header line. Values with commas or quotes are quoted. */
export function toCsv(rows: readonly Record<string, string | number>[]): string {
  if (rows.length === 0) return ''
  const columns = Object.keys(rows[0])
  const cell = (value: string | number) => {
    const text = String(value)
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
  }
  const lines = [
    columns.join(','),
    ...rows.map((row) => columns.map((c) => cell(row[c])).join(',')),
  ]
  return lines.join('\n') + '\n'
}

/** Reads CSV text written by toCsv back into rows of strings. */
export function fromCsv(text: string): Record<string, string>[] {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length === 0 || lines[0] === '') return []
  const parse = (line: string): string[] => {
    const cells: string[] = []
    let current = ''
    let quoted = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (quoted) {
        if (ch === '"' && line[i + 1] === '"') {
          current += '"'
          i++
        } else if (ch === '"') {
          quoted = false
        } else {
          current += ch
        }
      } else if (ch === '"') {
        quoted = true
      } else if (ch === ',') {
        cells.push(current)
        current = ''
      } else {
        current += ch
      }
    }
    cells.push(current)
    return cells
  }
  const columns = parse(lines[0])
  return lines.slice(1).map((line) => {
    const cells = parse(line)
    return Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? '']))
  })
}

/** What the benchmarks ran on, for the report. */
export function machineInfo(): { cpu: string; cores: number; node: string; os: string } {
  const all = cpus()
  return {
    cpu: all[0]?.model.trim() ?? 'unknown',
    cores: all.length,
    node: process.version,
    os: `${platform()} ${release()}`,
  }
}
