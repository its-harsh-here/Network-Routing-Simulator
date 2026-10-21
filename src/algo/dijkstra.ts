import type { Graph, NodeId } from '../ds/Graph.ts'
import { MinHeap } from '../ds/MinHeap.ts'
import { requireNode, type ShortestPaths } from './common.ts'

interface HeapEntry {
  node: NodeId
  dist: number
}

/**
 * Dijkstra's single-source shortest paths over the links that are up.
 *
 * Uses a MinHeap with lazy deletion. Instead of decreasing a node's key when a shorter path is
 * found, it pushes a new entry and leaves the old one in the heap. When an entry is popped
 * whose distance is larger than the node's current best, it is stale and is skipped.
 *
 * Correct because every edge cost is > 0 (Graph enforces this): once the closest unsettled
 * node is popped, no later path to it can be shorter.
 *
 * Time: O((V + E) log V). Each node is settled once and each edge is relaxed at most twice
 * (once from each end), so there are O(E) pushes and pops at O(log E) = O(log V) each.
 * @throws Error if `source` is not in the graph.
 */
export function dijkstra(graph: Graph, source: NodeId): ShortestPaths {
  requireNode(graph, source)
  const dist = new Map<NodeId, number>()
  for (const node of graph.nodes()) dist.set(node, Infinity)
  const prev = new Map<NodeId, NodeId>()
  const heap = new MinHeap<HeapEntry>((x, y) => x.dist - y.dist)

  dist.set(source, 0)
  heap.push({ node: source, dist: 0 })
  while (!heap.isEmpty()) {
    const { node, dist: nodeDist } = heap.pop() as HeapEntry
    if (nodeDist > (dist.get(node) as number)) continue // stale: a shorter path was found later

    for (const { node: next, edge } of graph.neighbors(node, { onlyUp: true })) {
      const candidate = nodeDist + edge.cost
      if (candidate < (dist.get(next) as number)) {
        dist.set(next, candidate)
        prev.set(next, node)
        heap.push({ node: next, dist: candidate })
      }
    }
  }
  return { dist, prev }
}

/**
 * Follows `prev` back from `target` and returns the path in source-to-target order.
 * If `target` has no predecessor, the result is just [target]. That happens both when target
 * is the source and when it is unreachable, so check `dist.get(target)` first.
 * Time: O(path length).
 * @throws Error if `prev` contains a cycle (possible only with a Bellman-Ford result that
 *   reported a negative cycle).
 */
export function pathTo(prev: ReadonlyMap<NodeId, NodeId>, target: NodeId): NodeId[] {
  const path = [target]
  let node = target
  while (prev.has(node)) {
    node = prev.get(node) as NodeId
    path.push(node)
    if (path.length > prev.size + 1) throw new Error('pathTo: prev contains a cycle')
  }
  return path.reverse()
}

/**
 * Builds the forwarding table of router `source`: for each reachable destination, the
 * neighbour to send a packet to next (the second node on the shortest path). The source itself
 * and unreachable nodes are left out.
 *
 * Time: O((V + E) log V) for Dijkstra, plus O(V) for the table (see forwardingTableFrom).
 * @throws Error if `source` is not in the graph.
 */
export function buildForwardingTable(graph: Graph, source: NodeId): Map<NodeId, NodeId> {
  return forwardingTableFrom(dijkstra(graph, source).prev, source)
}

/**
 * The forwarding table of `source` from an existing shortest-path tree (`prev` from dijkstra).
 * The next hop of a node equals the next hop of its predecessor, except for the source's direct
 * neighbours, whose next hop is themselves. Each destination walks back along `prev` only until
 * it reaches a node whose next hop is already known, so every node is walked over once.
 * Time: O(V).
 */
export function forwardingTableFrom(
  prev: ReadonlyMap<NodeId, NodeId>,
  source: NodeId,
): Map<NodeId, NodeId> {
  const table = new Map<NodeId, NodeId>()
  for (const destination of prev.keys()) {
    const walked: NodeId[] = []
    let node = destination
    while (!table.has(node) && prev.get(node) !== source) {
      walked.push(node)
      node = prev.get(node) as NodeId
    }
    // `node` is either a direct neighbour of the source or already has a next hop.
    const hop = table.get(node) ?? node
    table.set(node, hop)
    for (const visited of walked) table.set(visited, hop)
  }
  return table
}
