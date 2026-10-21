// The analysis overlays: the minimum spanning tree (the cheapest way to reach every router once,
// for broadcasts) and the weak spots (bridges and articulation points). Pure functions of a graph.
import { kruskalMST } from '../algo/kruskal.ts'
import { findBridgesAndArticulationPoints } from '../algo/tarjan.ts'
import type { EdgeId, Graph, NodeId } from '../ds/Graph.ts'
import {
  simulateBroadcast,
  type BroadcastMessage,
  type BroadcastResult,
  type BroadcastStrategy,
} from '../routing/broadcast.ts'
import { byName } from './inspect.ts'

/** Which analysis overlays are switched on. */
export interface OverlayToggles {
  /** The minimum spanning tree. */
  mst: boolean
  /** Bridges and articulation points. */
  weakSpots: boolean
}

export interface NetworkAnalysis {
  /** Links of the minimum spanning forest, from Kruskal (links that are down are left out). */
  mstLinks: EdgeId[]
  /** Total cost of those links. */
  mstCost: number
  /**
   * Separate parts the links that are up form: 1 if the network is connected. A spanning forest
   * has one tree per part, and each tree has one link fewer than routers, so this is V - |forest|.
   */
  parts: number
  /** Links whose failure would split the network (Tarjan's low-link method). */
  bridges: EdgeId[]
  /** Routers whose failure would split the network. */
  articulationPoints: NodeId[]
}

/**
 * MST, bridges and articulation points of the network as it is now: links that are down are
 * ignored, as by every algorithm here. Time: O(E log E) for Kruskal's sort, plus O(V + E) for
 * Tarjan's DFS.
 */
export function analyzeNetwork(graph: Graph): NetworkAnalysis {
  const forest = kruskalMST(graph)
  const { bridges, articulationPoints } = findBridgesAndArticulationPoints(graph)
  return {
    mstLinks: forest.map((edge) => edge.id),
    mstCost: forest.reduce((sum, edge) => sum + edge.cost, 0),
    parts: graph.nodeCount - forest.length,
    bridges: bridges.map((edge) => edge.id).sort(byName),
    articulationPoints: [...articulationPoints].sort(byName),
  }
}

/** A broadcast shown on the map, and both ways of doing it, for the comparison table. */
export interface BroadcastDemo {
  source: NodeId
  /** Simulated time the broadcast started: it plays on the simulation clock. */
  startedAt: number
  /** Which of the two is drawn on the map. */
  shown: BroadcastStrategy
  tree: BroadcastResult
  flood: BroadcastResult
}

/** How long a finished broadcast stays on the map, in simulated ms. */
export const BROADCAST_HOLD_MS = 1_500

/**
 * Plans a broadcast from `source` over the network as it is now, both along the MST and by
 * flooding. Time: O(E log E) for the MST, plus the two simulations.
 */
export function planBroadcast(
  graph: Graph,
  source: NodeId,
  startedAt: number,
  shown: BroadcastStrategy,
): BroadcastDemo {
  const treeLinks = new Set(kruskalMST(graph).map((edge) => edge.id))
  return {
    source,
    startedAt,
    shown,
    tree: simulateBroadcast(graph, source, 'tree', treeLinks),
    flood: simulateBroadcast(graph, source, 'flood'),
  }
}

/** A broadcast at one moment: all its copies, who has the message when, and the time since it began. */
export interface BroadcastFrame {
  messages: readonly BroadcastMessage[]
  reached: ReadonlyMap<NodeId, number>
  elapsedMs: number
}

/**
 * What to draw of a broadcast at simulated time `now`, or null once it has finished and been on
 * show for BROADCAST_HOLD_MS. Time: O(M) for M copies.
 */
export function broadcastFrame(demo: BroadcastDemo, now: number): BroadcastFrame | null {
  const result = demo.shown === 'tree' ? demo.tree : demo.flood
  const elapsedMs = now - demo.startedAt
  const lastArrival = result.messages.reduce((latest, m) => Math.max(latest, m.arriveAt), 0)
  if (elapsedMs < 0 || elapsedMs > lastArrival + BROADCAST_HOLD_MS) return null
  return { messages: result.messages, reached: result.reached, elapsedMs }
}
