import type { NodeId } from '../ds/Graph.ts'
import type { Packet } from './Packet.ts'
import { createQueue, type PacketQueue, type QueueDiscipline } from './queues.ts'

/** What a router decides to do with a packet that has just arrived. */
export type RouteDecision =
  | { readonly kind: 'deliver' }
  | { readonly kind: 'drop'; readonly reason: 'ttl-expired' | 'no-route' }
  | { readonly kind: 'forward'; readonly nextHop: NodeId }

/** What a router has done with packets so far, for the router inspector. */
export interface RouterCounters {
  /** Packets created here. */
  originated: number
  /** Packets this router put on a link: its own and those passing through. */
  forwarded: number
  /** Packets that reached this router as their destination. */
  delivered: number
  /** Packets dropped here (any reason; a cut link counts against the router sending on it). */
  dropped: number
}

/**
 * A simulated router's data plane: one bounded output queue per neighbour (first-in first-out
 * or strict priority). Which neighbour a packet goes to next is decided by the routing protocol
 * (the control plane).
 */
export class Router {
  readonly id: NodeId
  /** Updated by the simulator, which sees where each packet goes. */
  readonly counters: RouterCounters = { originated: 0, forwarded: 0, delivered: 0, dropped: 0 }
  private readonly queues = new Map<NodeId, PacketQueue>()

  /**
   * Creates a router with an empty queue of `queueCapacity` packets towards each neighbour,
   * using the discipline `disciplineFor` gives for that neighbour (first-in first-out unless
   * told otherwise).
   * Time: O(neighbours * queueCapacity) to allocate the queues.
   */
  constructor(
    id: NodeId,
    neighbours: Iterable<NodeId>,
    queueCapacity: number,
    disciplineFor: (neighbour: NodeId) => QueueDiscipline = () => 'fifo',
  ) {
    this.id = id
    for (const neighbour of neighbours) {
      this.queues.set(neighbour, createQueue(disciplineFor(neighbour), queueCapacity))
    }
  }

  /** Ids of the neighbours this router has a queue towards. Time: O(neighbours). */
  neighbours(): NodeId[] {
    return [...this.queues.keys()]
  }

  /**
   * The output queue towards `neighbour`. Time: O(1).
   * @throws Error if `neighbour` is not a neighbour of this router.
   */
  queueTo(neighbour: NodeId): PacketQueue {
    const queue = this.queues.get(neighbour)
    if (queue === undefined) throw new Error(`router ${this.id} has no link to ${neighbour}`)
    return queue
  }

  /** Total packets waiting in all output queues. Time: O(neighbours). */
  get queuedCount(): number {
    let total = 0
    for (const queue of this.queues.values()) total += queue.size
    return total
  }

  /** Queue length towards each neighbour, as plain data. Time: O(neighbours). */
  queueLengths(): Record<NodeId, number> {
    const lengths: Record<NodeId, number> = {}
    for (const [neighbour, queue] of this.queues) lengths[neighbour] = queue.size
    return lengths
  }

  /**
   * Decides what to do with `packet`, which has just arrived here, given the next hop the
   * routing protocol chose for its destination (undefined if there is no route). Checks, in
   * order: is this the destination; has the TTL run out; is there a route. Does not change the
   * packet.
   * Time: O(1).
   */
  route(packet: Packet, nextHop: NodeId | undefined): RouteDecision {
    if (packet.dst === this.id) return { kind: 'deliver' }
    if (packet.ttl <= 0) return { kind: 'drop', reason: 'ttl-expired' }
    if (nextHop === undefined) return { kind: 'drop', reason: 'no-route' }
    return { kind: 'forward', nextHop }
  }
}
