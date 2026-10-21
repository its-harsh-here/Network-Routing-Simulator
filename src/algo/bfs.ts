import { Deque } from '../ds/Deque.ts'
import type { Graph, NodeId } from '../ds/Graph.ts'
import { requireNode } from './common.ts'

/** Result of a breadth-first search. */
export interface BfsResult {
  /** Fewest links from the source to each node. Infinity if unreachable. */
  hops: Map<NodeId, number>
  /** The node each reachable node was discovered from. The source and unreachable nodes have no entry. */
  parent: Map<NodeId, NodeId>
}

/**
 * Breadth-first search from `source` over the links that are up, ignoring costs. Nodes leave a
 * FIFO queue in order of hop count, so the first time a node is discovered is along a path
 * with the fewest links.
 * Time: O(V + E). Each node is queued once and each edge is looked at twice (once per end).
 * @throws Error if `source` is not in the graph.
 */
export function bfs(graph: Graph, source: NodeId): BfsResult {
  requireNode(graph, source)
  const hops = new Map<NodeId, number>()
  for (const node of graph.nodes()) hops.set(node, Infinity)
  const parent = new Map<NodeId, NodeId>()
  const queue = new Deque<NodeId>()

  hops.set(source, 0)
  queue.pushBack(source)
  while (!queue.isEmpty()) {
    const node = queue.popFront() as NodeId
    const nextHops = (hops.get(node) as number) + 1
    for (const { node: next } of graph.neighbors(node, { onlyUp: true })) {
      if (hops.get(next) !== Infinity) continue // already discovered
      hops.set(next, nextHops)
      parent.set(next, node)
      queue.pushBack(next)
    }
  }
  return { hops, parent }
}

/**
 * True if every node can reach every other node over links that are up. A graph with zero or
 * one node counts as connected.
 * Time: O(V + E), one BFS.
 */
export function isConnected(graph: Graph): boolean {
  const nodes = graph.nodes()
  if (nodes.length === 0) return true
  const { hops } = bfs(graph, nodes[0])
  for (const count of hops.values()) {
    if (count === Infinity) return false
  }
  return true
}
