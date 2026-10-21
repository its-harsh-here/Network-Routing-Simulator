// Broadcast: getting one message from a router to every router. Two ways are compared:
// - flooding: every router passes the message on to all its neighbours (except the one it came
//   from) the first time it gets it, and drops later copies, like LSAs;
// - tree: the same, but only across the links of a spanning tree (the MST), so no router ever
//   gets a second copy.
import type { EdgeId, Graph, NodeId } from '../ds/Graph.ts'
import { MinHeap } from '../ds/MinHeap.ts'

export type BroadcastStrategy = 'flood' | 'tree'

/** One copy of the message crossing one link. */
export interface BroadcastMessage {
  from: NodeId
  to: NodeId
  linkId: EdgeId
  /** Milliseconds after the broadcast started. */
  sendAt: number
  arriveAt: number
  /** The receiver already had the message: a wasted copy (flooding only). */
  duplicate: boolean
}

export interface BroadcastResult {
  strategy: BroadcastStrategy
  source: NodeId
  /** Every copy sent, in the order they were sent. */
  messages: BroadcastMessage[]
  /** When each router reached first got the message (the source at 0). */
  reached: Map<NodeId, number>
  /** Copies that arrived at a router that already had the message. */
  duplicates: number
  /** When the last router reached got it. */
  doneAt: number
}

interface Arrival {
  message: BroadcastMessage
  seq: number
}

/** Earliest arrival first; ties in the order the copies were sent. */
const earliest = (x: Arrival, y: Arrival) =>
  x.message.arriveAt - y.message.arriveAt || x.seq - y.seq

/**
 * Simulates one broadcast from `source` as a small discrete-event run: arrivals wait in a
 * MinHeap by time. A copy takes the link's delay (broadcasts skip the data queues, like routing
 * messages), and links that are down are not used. For 'tree', only links in `treeLinks` carry it.
 *
 * Message counts, for a connected network of V routers and E links: flooding sends
 * deg(source) + sum over the others of (deg - 1) = 2E - V + 1 copies, of which V - 1 are useful;
 * a tree sends exactly V - 1, one per tree link.
 * Time: O(M log M) for M copies.
 * @throws Error if `source` is not a router of the graph.
 */
export function simulateBroadcast(
  graph: Graph,
  source: NodeId,
  strategy: BroadcastStrategy,
  treeLinks: ReadonlySet<EdgeId> = new Set(),
): BroadcastResult {
  if (!graph.hasNode(source)) throw new Error(`unknown router "${source}"`)
  const messages: BroadcastMessage[] = []
  const reached = new Map<NodeId, number>([[source, 0]])
  const arrivals = new MinHeap<Arrival>(earliest)
  let duplicates = 0

  /** `router` got the message at `time` from `from`: it passes it on. */
  const passOn = (router: NodeId, from: NodeId | null, time: number) => {
    for (const { node, edge } of graph.neighbors(router, { onlyUp: true })) {
      if (node === from) continue
      if (strategy === 'tree' && !treeLinks.has(edge.id)) continue
      const message = {
        from: router,
        to: node,
        linkId: edge.id,
        sendAt: time,
        arriveAt: time + edge.delayMs,
        duplicate: false,
      }
      messages.push(message)
      arrivals.push({ message, seq: messages.length })
    }
  }

  passOn(source, null, 0)
  while (!arrivals.isEmpty()) {
    const { message } = arrivals.pop() as Arrival
    if (reached.has(message.to)) {
      message.duplicate = true // it already had the message: drop this copy
      duplicates++
      continue
    }
    reached.set(message.to, message.arriveAt)
    passOn(message.to, message.from, message.arriveAt)
  }
  return { strategy, source, messages, reached, duplicates, doneAt: Math.max(...reached.values()) }
}
