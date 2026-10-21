import type { Graph, NodeId } from '../ds/Graph.ts'
import { requireNode, type ShortestPaths } from './common.ts'

/** A one-way connection with a cost, which may be negative. */
export interface Arc {
  readonly from: NodeId
  readonly to: NodeId
  readonly cost: number
}

/** Bellman-Ford result. When `hasNegativeCycle` is true, `dist` and `prev` are not meaningful. */
export interface BellmanFordResult extends ShortestPaths {
  /** True if a cycle with negative total cost can be reached from the source. */
  hasNegativeCycle: boolean
}

/**
 * Bellman-Ford shortest paths over the links of `graph` that are up. Each undirected edge
 * becomes two arcs, one in each direction.
 *
 * Graph only allows costs > 0, so a graph never has a negative cycle. (A negative undirected
 * edge would be one on its own: a -> b -> a.) Use bellmanFordArcs to work with negative costs.
 *
 * Time: O(V * E), see bellmanFordArcs.
 * @throws Error if `source` is not in the graph.
 */
export function bellmanFord(graph: Graph, source: NodeId): BellmanFordResult {
  requireNode(graph, source)
  const arcs: Arc[] = []
  for (const edge of graph.edges()) {
    if (!edge.up) continue
    arcs.push({ from: edge.a, to: edge.b, cost: edge.cost })
    arcs.push({ from: edge.b, to: edge.a, cost: edge.cost })
  }
  return bellmanFordArcs(graph.nodes(), arcs, source)
}

/**
 * Bellman-Ford shortest paths over one-way arcs, which may have negative costs.
 *
 * After round k, dist[v] is no more than the cost of the cheapest path to v that uses at most k
 * arcs. A cheapest path without repeated nodes has at most V - 1 arcs, so V - 1 rounds are
 * enough. If one more round can still lower a distance, there is a negative cycle reachable
 * from the source. The rounds stop early once nothing changes.
 *
 * Time: O(V * E): up to V rounds that each relax all E arcs.
 * @throws Error if `source` or an arc endpoint is not in `nodes`.
 */
export function bellmanFordArcs(
  nodes: readonly NodeId[],
  arcs: readonly Arc[],
  source: NodeId,
): BellmanFordResult {
  const dist = new Map<NodeId, number>()
  for (const node of nodes) dist.set(node, Infinity)
  if (!dist.has(source)) throw new Error(`unknown source node "${source}"`)
  for (const { from, to } of arcs) {
    if (!dist.has(from) || !dist.has(to))
      throw new Error(`arc ${from} -> ${to} uses an unknown node`)
  }
  const prev = new Map<NodeId, NodeId>()
  dist.set(source, 0)

  /** Relaxes every arc once and returns true if any distance went down. */
  const relaxAll = (): boolean => {
    let changed = false
    for (const { from, to, cost } of arcs) {
      const fromDist = dist.get(from) as number
      if (fromDist === Infinity) continue
      if (fromDist + cost < (dist.get(to) as number)) {
        dist.set(to, fromDist + cost)
        prev.set(to, from)
        changed = true
      }
    }
    return changed
  }

  for (let round = 1; round < dist.size; round++) {
    if (!relaxAll()) return { dist, prev, hasNegativeCycle: false }
  }
  return { dist, prev, hasNegativeCycle: relaxAll() }
}
