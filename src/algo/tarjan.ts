import type { Edge, Graph, Neighbor, NodeId } from '../ds/Graph.ts'

/** Result of findBridgesAndArticulationPoints. */
export interface BridgesAndArticulationPoints {
  /** Links whose failure would split their component. */
  bridges: Edge[]
  /** Routers whose failure would split their component. */
  articulationPoints: NodeId[]
}

/** One level of the explicit DFS stack: what a recursive call would keep in its local variables. */
interface Frame {
  node: NodeId
  /** The tree edge used to reach `node`, or undefined for the root. */
  parentEdge: Edge | undefined
  neighbors: Neighbor[]
  /** Index of the next neighbour to look at. */
  nextIndex: number
}

/**
 * Finds bridges and articulation points over the links that are up, using Tarjan's low-link
 * method.
 *
 * A DFS numbers nodes in the order it discovers them (disc). low[v] is the smallest disc number
 * reachable from v's DFS subtree using at most one non-tree edge. For a tree edge from parent p
 * to child c:
 * - If low[c] > disc[p], nothing under c reaches p or above, so edge p-c is a bridge.
 * - If low[c] >= disc[p], nothing under c reaches above p, so p is an articulation point,
 *   unless p is the root. The root is one only if it has two or more DFS children.
 *
 * The DFS uses an explicit stack instead of recursion, so a 20,000-node path does not overflow
 * the call stack.
 *
 * Time: O(V + E). Each node is pushed once and each edge is looked at twice (once per end).
 */
export function findBridgesAndArticulationPoints(graph: Graph): BridgesAndArticulationPoints {
  const disc = new Map<NodeId, number>()
  const low = new Map<NodeId, number>()
  const bridges: Edge[] = []
  const articulationPoints = new Set<NodeId>()
  let time = 0

  const discover = (node: NodeId, parentEdge: Edge | undefined): Frame => {
    disc.set(node, time)
    low.set(node, time)
    time++
    return { node, parentEdge, neighbors: graph.neighbors(node, { onlyUp: true }), nextIndex: 0 }
  }

  for (const root of graph.nodes()) {
    if (disc.has(root)) continue
    const stack: Frame[] = [discover(root, undefined)]
    let rootChildren = 0

    while (stack.length > 0) {
      const frame = stack[stack.length - 1]

      if (frame.nextIndex < frame.neighbors.length) {
        // Look at the next edge, like one iteration of the loop in the recursive version.
        const { node: next, edge } = frame.neighbors[frame.nextIndex++]
        if (edge.id === frame.parentEdge?.id) continue // don't walk back along the tree edge
        if (!disc.has(next)) {
          if (frame.node === root) rootChildren++
          stack.push(discover(next, edge)) // the "recursive call"
        } else {
          // Non-tree edge to a node already discovered: it may lower our low-link.
          low.set(frame.node, Math.min(low.get(frame.node) as number, disc.get(next) as number))
        }
        continue
      }

      // All edges done: return to the parent, like the code after the recursive call.
      stack.pop()
      const parent = stack[stack.length - 1]
      if (parent === undefined) continue // the root has finished
      const childLow = low.get(frame.node) as number
      const parentDisc = disc.get(parent.node) as number
      low.set(parent.node, Math.min(low.get(parent.node) as number, childLow))
      if (childLow > parentDisc) bridges.push(frame.parentEdge as Edge)
      if (parent.node !== root && childLow >= parentDisc) articulationPoints.add(parent.node)
    }

    if (rootChildren >= 2) articulationPoints.add(root)
  }

  return { bridges, articulationPoints: [...articulationPoints] }
}
