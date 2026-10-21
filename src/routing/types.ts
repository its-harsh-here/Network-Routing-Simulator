import type { EdgeId, Graph, NodeId } from '../ds/Graph.ts'

/** The routing protocols the simulator can run. */
export type ProtocolName = 'link-state' | 'distance-vector'
export const PROTOCOL_NAMES: readonly ProtocolName[] = ['link-state', 'distance-vector']

/**
 * A link-state advertisement: what router `origin` says about its own links. A higher `seq`
 * replaces any older advertisement from the same origin.
 */
export interface Lsa {
  readonly origin: NodeId
  readonly seq: number
  /** Each of the origin's links, and whether the origin believes it is up. */
  readonly links: readonly (readonly [EdgeId, boolean])[]
}

/** A routing message sent from one router to a neighbour. */
export type ControlMessage =
  /** A distance vector: the sender's cost to each destination it advertises. */
  | { readonly kind: 'distance-vector'; readonly entries: readonly (readonly [NodeId, number])[] }
  /** Link-state advertisements being flooded (or a whole database, when two routers resync). */
  | { readonly kind: 'lsa'; readonly lsas: readonly Lsa[] }

/** A timer a protocol asked for. It comes back to the protocol's onTimer. */
export type RoutingTimer =
  /** Distance-vector: time for `router` to send its periodic update. */
  | { readonly kind: 'dv-periodic'; readonly router: NodeId }
  /** Check whether routing has gone quiet (see QuietDetector). */
  | { readonly kind: 'quiet' }

/** A link change that the two routers at its ends have just noticed. */
export interface LinkChange {
  readonly changeId: number
  readonly linkId: EdgeId
  readonly a: NodeId
  readonly b: NodeId
  readonly up: boolean
}

/** One row of a router's routing table, as plain data for display. */
export interface RouteEntry {
  destination: NodeId
  /** The neighbour packets go to, or null when there is no usable route. */
  nextHop: NodeId | null
  cost: number
  /** False for a destination the router knows about but cannot reach (cost 16 in distance-vector). */
  reachable: boolean
}

/**
 * What a protocol may see and do. The simulator implements it; protocols never touch the
 * simulator directly, so they are easy to test and to swap.
 */
export interface RoutingContext {
  /** Current simulated time in ms. */
  now(): number
  /** Every router, in a fixed order. */
  readonly routerIds: readonly NodeId[]
  /**
   * The links as the routers have noticed them: a link going down or up reaches this graph only
   * when the routers at its ends detect it. Protocols must use this, not the real topology.
   */
  readonly knownGraph: Graph
  /**
   * Sends `message` from `from` to its neighbour `to`. It arrives after the link's delay,
   * skipping the data queues, unless the link is down when it is sent or goes down on the way.
   */
  sendControl(from: NodeId, to: NodeId, message: ControlMessage): void
  /** How many control messages are on links right now (sent, not yet arrived or lost). */
  controlInFlight(): number
  /** Calls the protocol's onTimer with `timer` after `delayMs`. */
  setTimer(delayMs: number, timer: RoutingTimer): void
  /**
   * Reports that `router`'s routes changed. The simulator credits the change to the link changes
   * still converging and re-forwards packets stuck behind links that are down.
   */
  routesChanged(router: NodeId): void
  /** Marks link change `changeId` as fully handled: later route changes are not credited to it. */
  settleChange(changeId: number): void
  /** Marks every detected link change that is not settled yet as handled. */
  settleOpenChanges(): void
}

/**
 * A routing protocol: the control plane that fills in every router's routes. The simulator's
 * data plane asks getNextHop for each packet.
 */
export interface RoutingProtocol {
  readonly name: ProtocolName
  /** Sets up every router's routes (or starts the protocol's exchange). Called once. */
  onStart(ctx: RoutingContext): void
  /** The routers at the ends of a link have noticed it went down or up. */
  onLinkChange(ctx: RoutingContext, change: LinkChange): void
  /** `router` received `message` from its neighbour `from`. */
  onControlMessage(ctx: RoutingContext, router: NodeId, from: NodeId, message: ControlMessage): void
  /** A timer set with ctx.setTimer has fired. */
  onTimer(ctx: RoutingContext, timer: RoutingTimer): void
  /** The neighbour `router` sends packets for `destination` to, or undefined if it has no route. */
  getNextHop(router: NodeId, destination: NodeId): NodeId | undefined
  /** `router`'s current routes, for display. Does not include the router itself. */
  routingTable(router: NodeId): RouteEntry[]
}
