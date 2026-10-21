import type { Graph, NodeId } from '../ds/Graph.ts'

/** Result of a single-source shortest-path algorithm. */
export interface ShortestPaths {
  /** Cost of the cheapest path from the source to each node. Infinity if unreachable. */
  dist: Map<NodeId, number>
  /**
   * The node just before each reachable node on its cheapest path. The source and unreachable
   * nodes have no entry.
   */
  prev: Map<NodeId, NodeId>
}

/** Throws if `node` is not in the graph. Time: O(1). */
export function requireNode(graph: Graph, node: NodeId): void {
  if (!graph.hasNode(node)) throw new Error(`unknown source node "${node}"`)
}
