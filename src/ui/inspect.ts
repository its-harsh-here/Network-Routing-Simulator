// What the inspectors show: a router's queues and counters, one packet's journey, and the path
// between two routers. Pure functions of the simulator's state, read a few times a second.
import { dijkstra, pathTo } from '../algo/dijkstra.ts'
import type { EdgeId, NodeId } from '../ds/Graph.ts'
import type { DropReason, Packet, PacketStatus, Priority } from '../sim/Packet.ts'
import type { QueueDiscipline } from '../sim/queues.ts'
import type { RouterCounters } from '../sim/Router.ts'
import type { Simulator, Snapshot } from '../sim/Simulator.ts'

/** Sorts router names so that R2 comes before R10. O(1) per comparison of short names. */
export const byName = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true })

/** One output queue of a router, with the packets in it in sending order. */
export interface QueueView {
  neighbour: NodeId
  linkId: EdgeId
  linkUp: boolean
  discipline: QueueDiscipline
  capacity: number
  packets: { id: number; priority: Priority; dst: NodeId }[]
}

export interface RouterInspection {
  id: NodeId
  counters: RouterCounters
  /** One per neighbour, by neighbour name. */
  queues: QueueView[]
}

/**
 * A router's counters and the contents of each of its output queues, or null if there is no
 * such router. Time: O(d + q log q) for d neighbours and q queued packets.
 */
export function inspectRouter(sim: Simulator, id: NodeId): RouterInspection | null {
  const router = sim.routers.get(id)
  if (router === undefined) return null
  const queues = router
    .neighbours()
    .sort(byName)
    .map((neighbour): QueueView => {
      const queue = router.queueTo(neighbour)
      const edge = sim.graph.edgeBetween(id, neighbour)
      return {
        neighbour,
        linkId: edge?.id ?? '',
        linkUp: edge?.up ?? false,
        discipline: queue.discipline,
        capacity: queue.capacity,
        packets: queue.toArray().map(({ id, priority, dst }) => ({ id, priority, dst })),
      }
    })
  return { id, counters: { ...router.counters }, queues }
}

export interface PacketInspection {
  id: number
  src: NodeId
  dst: NodeId
  priority: Priority
  sizeBytes: number
  status: PacketStatus
  dropReason: DropReason | null
  /** The routers it has reached, starting at its source. */
  hops: NodeId[]
  /** Links crossed so far. */
  hopCount: number
  /** Time since it was created, or its whole lifetime once finished. */
  ageMs: number
  ttl: number
  /** Where it is now, in words: "waiting at R5 for the link to R6", "delivered", ... */
  location: string
}

/**
 * One packet's journey so far. The packet object is the simulator's own, which it keeps
 * updating, so calling this again gives the latest state. Time: O(P + d * q) to find the
 * packet on a link (P packets on links) or in a queue (d queues of up to q packets).
 */
export function inspectPacket(
  packet: Packet,
  sim: Simulator,
  snapshot: Snapshot,
): PacketInspection {
  const at = packet.hops[packet.hops.length - 1]
  let location: string
  if (packet.status === 'delivered') {
    location = `delivered to ${packet.dst}`
  } else if (packet.status === 'dropped') {
    location = `dropped at ${at} (${packet.dropReason})`
  } else if (packet.status === 'queued') {
    const router = sim.routers.get(at)
    const towards = router?.neighbours().find((n) => router.queueTo(n).toArray().includes(packet))
    location = towards === undefined ? `at ${at}` : `waiting at ${at} for the link to ${towards}`
  } else {
    const flight = snapshot.packets.find((p) => p.id === packet.id)
    const link = flight === undefined ? 'a link' : `${flight.from} → ${flight.to}`
    location = packet.status === 'transmitting' ? `being sent on ${link}` : `travelling on ${link}`
  }
  return {
    id: packet.id,
    src: packet.src,
    dst: packet.dst,
    priority: packet.priority,
    sizeBytes: packet.sizeBytes,
    status: packet.status,
    dropReason: packet.dropReason ?? null,
    hops: [...packet.hops],
    hopCount: Math.max(0, packet.hops.length - 1),
    ageMs: (packet.finishedAt ?? sim.now) - packet.createdAt,
    ttl: packet.ttl,
    location,
  }
}

/** How following the routers' next hops ends. */
export type ForwardingOutcome =
  /** The packet would reach the destination. */
  | 'arrives'
  /** A router on the way has no route. */
  | 'no-route'
  /** The next hops lead back to a router already on the path. */
  | 'loop'
  /** A router still sends over a link that is down, because it has not noticed yet. */
  | 'dead-link'

export interface PathInspection {
  from: NodeId
  to: NodeId
  /** Dijkstra on the network as it is now (links that are down left out); null if unreachable. */
  shortest: { path: NodeId[]; cost: number; hops: number } | null
  /** Where a packet would go now, following each router's forwarding table. */
  forwarding: { path: NodeId[]; outcome: ForwardingOutcome; cost: number | null }
  /** True if the routers forward along a shortest path (any one of equal cost). */
  agrees: boolean
}

/**
 * The shortest path between two routers, and the path the routers actually forward along,
 * which differs while the network converges. Null if either router does not exist.
 * Time: O((V + E) log V) for Dijkstra, plus O(V) to follow the next hops.
 */
export function inspectPath(sim: Simulator, from: NodeId, to: NodeId): PathInspection | null {
  if (!sim.graph.hasNode(from) || !sim.graph.hasNode(to) || from === to) return null
  const { dist, prev } = dijkstra(sim.graph, from)
  const cost = dist.get(to) as number
  const path = cost === Infinity ? null : pathTo(prev, to)
  const shortest = path === null ? null : { path, cost, hops: path.length - 1 }
  const forwarding = followNextHops(sim, from, to)
  // Costs are sums of link costs, so compare them with a little room for rounding.
  const agrees =
    shortest !== null &&
    forwarding.outcome === 'arrives' &&
    Math.abs((forwarding.cost as number) - shortest.cost) < 1e-9
  return { from, to, shortest, forwarding, agrees }
}

/** Follows next hops from `from` until `to`, a missing route, a loop or a dead link. O(V). */
function followNextHops(sim: Simulator, from: NodeId, to: NodeId): PathInspection['forwarding'] {
  const path = [from]
  const seen = new Set([from])
  let cost = 0
  let node = from
  while (node !== to) {
    const next = sim.nextHop(node, to)
    if (next === undefined) return { path, outcome: 'no-route', cost: null }
    const edge = sim.graph.edgeBetween(node, next)
    path.push(next)
    if (edge === undefined || !edge.up) return { path, outcome: 'dead-link', cost: null }
    if (seen.has(next)) return { path, outcome: 'loop', cost: null }
    seen.add(next)
    cost += edge.cost
    node = next
  }
  return { path, outcome: 'arrives', cost }
}
