import type { Graph, NodeId } from '../ds/Graph.ts'
import { requireNode, type ShortestPaths } from './common.ts'

/**
 * Dijkstra's algorithm without a heap, kept only as a benchmark baseline for dijkstra().
 * Distances live in a plain array indexed by node number, and each round finds the closest
 * unsettled node with a linear scan. Ignores links that are down.
 *
 * Time: O(V^2 + E). There are at most V rounds, each with an O(V) scan, and every edge is
 * relaxed at most twice. That beats the heap version only on very dense graphs.
 * @throws Error if `source` is not in the graph.
 */
export function dijkstraNaive(graph: Graph, source: NodeId): ShortestPaths {
  requireNode(graph, source)
  const nodes = graph.nodes()
  const indexOf = new Map<NodeId, number>()
  nodes.forEach((node, i) => indexOf.set(node, i))

  const dist: number[] = new Array<number>(nodes.length).fill(Infinity)
  const settled: boolean[] = new Array<boolean>(nodes.length).fill(false)
  const prev = new Map<NodeId, NodeId>()
  dist[indexOf.get(source) as number] = 0

  for (let round = 0; round < nodes.length; round++) {
    // Linear scan for the closest unsettled node.
    let closest = -1
    for (let i = 0; i < nodes.length; i++) {
      if (!settled[i] && dist[i] < Infinity && (closest === -1 || dist[i] < dist[closest])) {
        closest = i
      }
    }
    if (closest === -1) break // every remaining node is unreachable
    settled[closest] = true

    for (const { node: next, edge } of graph.neighbors(nodes[closest], { onlyUp: true })) {
      const j = indexOf.get(next) as number
      const candidate = dist[closest] + edge.cost
      if (candidate < dist[j]) {
        dist[j] = candidate
        prev.set(next, nodes[closest])
      }
    }
  }

  return { dist: new Map(nodes.map((node, i) => [node, dist[i]])), prev }
}
