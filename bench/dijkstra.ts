// Dijkstra with a binary heap (lazy deletion) against the naive O(V^2) version that scans for the
// closest node, on random connected sparse graphs.
import { dijkstra } from '../src/algo/dijkstra.ts'
import { dijkstraNaive } from '../src/algo/dijkstraNaive.ts'
import { Rng } from '../src/sim/rng.ts'
import { median, randomConnectedGraph, timeMs } from './lib.ts'

export const DIJKSTRA_SIZES = [100, 500, 1_000, 5_000, 10_000, 20_000]
export const DIJKSTRA_RUNS = 5
export const AVERAGE_DEGREE = 4

export interface DijkstraRow {
  [column: string]: string | number
  nodes: number
  links: number
  runs: number
  heap_median_ms: number
  naive_median_ms: number
  /** naive / heap: how many times faster the heap version is. */
  speedup: number
  heap_min_ms: number
  heap_max_ms: number
  naive_min_ms: number
  naive_max_ms: number
}

/**
 * Times both versions from node n0 on one random graph per size (seeded, so the same graphs
 * every time). Before timing, both are run once untimed (so the JIT has compiled them) and
 * their distances are compared: a timing of a wrong answer means nothing. The timed runs
 * alternate between the two, so machine noise hits both alike.
 * @throws Error if the two versions disagree on any distance.
 */
export function benchDijkstra(
  sizes: readonly number[] = DIJKSTRA_SIZES,
  runs = DIJKSTRA_RUNS,
  seed = 1,
  log: (line: string) => void = () => {},
): DijkstraRow[] {
  return sizes.map((nodes) => {
    const graph = randomConnectedGraph(new Rng(seed * 1_000_003 + nodes), nodes, AVERAGE_DEGREE)
    const source = 'n0'
    const fast = dijkstra(graph, source).dist
    const slow = dijkstraNaive(graph, source).dist
    for (const [node, distance] of fast) {
      if (Math.abs(distance - (slow.get(node) as number)) > 1e-9) {
        throw new Error(`V=${nodes}: the two versions disagree about ${node}`)
      }
    }
    const heap: number[] = []
    const naive: number[] = []
    for (let run = 0; run < runs; run++) {
      heap.push(timeMs(() => dijkstra(graph, source)))
      naive.push(timeMs(() => dijkstraNaive(graph, source)))
    }
    const row: DijkstraRow = {
      nodes,
      links: graph.edgeCount,
      runs,
      heap_median_ms: round(median(heap)),
      naive_median_ms: round(median(naive)),
      speedup: round(median(naive) / median(heap), 2),
      heap_min_ms: round(Math.min(...heap)),
      heap_max_ms: round(Math.max(...heap)),
      naive_min_ms: round(Math.min(...naive)),
      naive_max_ms: round(Math.max(...naive)),
    }
    log(
      `  V=${String(nodes).padStart(6)}  heap ${String(row.heap_median_ms).padStart(9)} ms` +
        `   naive ${String(row.naive_median_ms).padStart(10)} ms   (${row.speedup}x)`,
    )
    return row
  })
}

/** Rounds to `digits` decimals (3 by default: microseconds, for times in ms). */
export function round(value: number, digits = 3): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}
