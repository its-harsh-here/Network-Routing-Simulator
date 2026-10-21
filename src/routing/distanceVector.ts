import type { NodeId } from '../ds/Graph.ts'
import { QuietDetector } from './quiet.ts'
import type {
  ControlMessage,
  LinkChange,
  RouteEntry,
  RoutingContext,
  RoutingProtocol,
  RoutingTimer,
} from './types.ts'

/** RIP's infinity: a route costing this much or more is unreachable. */
export const DV_INFINITY = 16

export interface DistanceVectorOptions {
  /** Time between a router's periodic updates. */
  periodMs: number
  /** Leave out routes learned from a neighbour when advertising to that neighbour. */
  splitHorizon: boolean
  /** Advertise routes learned from a neighbour back to it as unreachable (16). Wins over split horizon. */
  poisonReverse: boolean
}

interface Route {
  cost: number
  /** The neighbour this route goes through; null for the router itself or an unreachable route. */
  nextHop: NodeId | null
}

/**
 * Distance-vector routing with distributed Bellman-Ford, in the style of RIP.
 *
 * Each router knows only its own links and the vectors its neighbours last sent it. Its own
 * vector is the Bellman-Ford equation over those:
 *   cost(dst) = min over neighbours v whose link is up of (link cost to v + v's cost to dst)
 * capped at DV_INFINITY (16), which means unreachable.
 *
 * A router sends its vector to every neighbour every periodMs, and at once whenever its vector
 * changes (a triggered update). Vectors travel as control messages with the link's delay.
 *
 * Because each router remembers its neighbours' last vectors, a stale vector can outlive the
 * route it describes. On the line A - B - C, cutting B-C makes B fall back on A's "C costs 2",
 * which really goes through B, so the two count up to 16 together (count to infinity). Split
 * horizon (do not tell a neighbour about routes learned from it) and poison reverse (tell it
 * they cost 16) both stop that two-router loop.
 */
export class DistanceVectorRouting implements RoutingProtocol {
  readonly name = 'distance-vector'
  private options: DistanceVectorOptions
  /** router -> destination -> route. */
  private readonly tables = new Map<NodeId, Map<NodeId, Route>>()
  /** router -> neighbour -> what that neighbour last advertised (destination -> cost). */
  private readonly heard = new Map<NodeId, Map<NodeId, Map<NodeId, number>>>()
  /** Settles open link changes once no route has changed for a while. */
  private readonly quiet = new QuietDetector(0)

  /** Time: O(1). */
  constructor(options: DistanceVectorOptions) {
    this.options = { ...options }
  }

  /** Changes split horizon or poison reverse; takes effect with the next update sent. O(1). */
  setOptions(
    options: Partial<Pick<DistanceVectorOptions, 'splitHorizon' | 'poisonReverse'>>,
  ): void {
    this.options = { ...this.options, ...options }
  }

  /** The current options. O(1). */
  getOptions(): Readonly<DistanceVectorOptions> {
    return this.options
  }

  /**
   * Gives every router a route to itself and to its direct neighbours, sends each router's first
   * vector, and starts the periodic updates, staggered evenly over one period so routers do not
   * all send at once.
   * Time: O(V * deg) to build the tables, plus one message per link direction.
   */
  onStart(ctx: RoutingContext): void {
    let maxDelay = 0
    for (const edge of ctx.knownGraph.edges()) maxDelay = Math.max(maxDelay, edge.delayMs)
    // After a full period plus the longest delay with no change, every router has advertised and
    // every advert has arrived without changing anything, so nothing will change any more.
    this.quiet.setQuietMs(this.options.periodMs + maxDelay)

    for (const router of ctx.routerIds) {
      this.tables.set(router, new Map([[router, { cost: 0, nextHop: null }]]))
      this.heard.set(router, new Map())
    }
    ctx.routerIds.forEach((router, i) => {
      this.recompute(ctx, router)
      this.advertise(ctx, router)
      const offset = (this.options.periodMs * (i + 1)) / ctx.routerIds.length
      ctx.setTimer(offset, { kind: 'dv-periodic', router })
    })
  }

  /**
   * The two routers at the link update their routes: a router whose link went down forgets that
   * neighbour's vector; a router whose link came up tells the new neighbour its vector at once.
   * Time: O(V * deg) for the two recomputes.
   */
  onLinkChange(ctx: RoutingContext, change: LinkChange): void {
    for (const [router, neighbour] of [
      [change.a, change.b],
      [change.b, change.a],
    ]) {
      if (!change.up) this.heard.get(router)?.delete(neighbour)
      if (this.recompute(ctx, router)) this.advertise(ctx, router)
      else if (change.up) this.send(ctx, router, neighbour)
    }
    this.quiet.noteActivity(ctx)
  }

  /**
   * Stores the neighbour's vector and re-runs Bellman-Ford; if the router's vector changed, it
   * sends a triggered update. Time: O(V * deg).
   */
  onControlMessage(
    ctx: RoutingContext,
    router: NodeId,
    from: NodeId,
    message: ControlMessage,
  ): void {
    if (message.kind !== 'distance-vector') return
    this.heard.get(router)?.set(from, new Map(message.entries))
    if (this.recompute(ctx, router)) this.advertise(ctx, router)
  }

  /** Periodic updates, and the quiet check that settles link changes. Time: O(V * deg). */
  onTimer(ctx: RoutingContext, timer: RoutingTimer): void {
    if (timer.kind === 'dv-periodic') {
      this.advertise(ctx, timer.router)
      ctx.setTimer(this.options.periodMs, timer)
    } else if (timer.kind === 'quiet') {
      this.quiet.onTimer(ctx)
    }
  }

  /** Time: O(1). */
  getNextHop(router: NodeId, destination: NodeId): NodeId | undefined {
    const route = this.tables.get(router)?.get(destination)
    if (route === undefined || destination === router || route.cost >= DV_INFINITY) return undefined
    return route.nextHop ?? undefined
  }

  /** Every destination the router has heard of, reachable or not. Time: O(V). */
  routingTable(router: NodeId): RouteEntry[] {
    const entries: RouteEntry[] = []
    for (const [destination, route] of this.tables.get(router) ?? []) {
      if (destination === router) continue
      const reachable = route.cost < DV_INFINITY
      entries.push({
        destination,
        nextHop: reachable ? route.nextHop : null,
        cost: route.cost,
        reachable,
      })
    }
    return entries
  }

  /**
   * Bellman-Ford for one router over its neighbours' last vectors. Any cost of 16 or more
   * becomes unreachable (16). Destinations it knew but can no longer reach stay in the table at
   * cost 16, so they are advertised as unreachable.
   * On a tie it keeps its current next hop, so routes do not flap. Returns true if the table
   * changed (and reports it).
   * Time: O(deg * V).
   */
  private recompute(ctx: RoutingContext, router: NodeId): boolean {
    const old = this.tables.get(router) as Map<NodeId, Route>
    const next = new Map<NodeId, Route>([[router, { cost: 0, nextHop: null }]])
    const consider = (destination: NodeId, cost: number, via: NodeId) => {
      const best = next.get(destination)
      const keepsCurrent = cost === best?.cost && old.get(destination)?.nextHop === via
      if (best === undefined || cost < best.cost || keepsCurrent) {
        next.set(destination, { cost, nextHop: via })
      }
    }

    const heardHere = this.heard.get(router) as Map<NodeId, Map<NodeId, number>>
    for (const { node: neighbour, edge } of ctx.knownGraph.neighbors(router, { onlyUp: true })) {
      consider(neighbour, edge.cost, neighbour)
      for (const [destination, cost] of heardHere.get(neighbour) ?? []) {
        if (destination !== router) consider(destination, edge.cost + cost, neighbour)
      }
    }
    for (const [destination, route] of next) {
      if (route.cost >= DV_INFINITY) next.set(destination, { cost: DV_INFINITY, nextHop: null })
    }
    for (const destination of old.keys()) {
      if (!next.has(destination)) next.set(destination, { cost: DV_INFINITY, nextHop: null })
    }

    if (sameRoutes(old, next)) return false
    this.tables.set(router, next)
    ctx.routesChanged(router)
    this.quiet.noteActivity(ctx)
    return true
  }

  /** Sends the router's vector to every neighbour whose link it believes is up. O(deg * V). */
  private advertise(ctx: RoutingContext, router: NodeId): void {
    for (const { node: neighbour } of ctx.knownGraph.neighbors(router, { onlyUp: true })) {
      this.send(ctx, router, neighbour)
    }
  }

  /** Sends the router's vector to one neighbour, applying split horizon / poison reverse. O(V). */
  private send(ctx: RoutingContext, router: NodeId, neighbour: NodeId): void {
    const entries: [NodeId, number][] = []
    for (const [destination, route] of this.tables.get(router) as Map<NodeId, Route>) {
      const learnedFromNeighbour = route.nextHop === neighbour && destination !== neighbour
      if (learnedFromNeighbour && this.options.poisonReverse)
        entries.push([destination, DV_INFINITY])
      else if (learnedFromNeighbour && this.options.splitHorizon) continue
      else entries.push([destination, route.cost])
    }
    ctx.sendControl(router, neighbour, { kind: 'distance-vector', entries })
  }
}

/** True if both tables have the same destinations with the same cost and next hop. O(V). */
function sameRoutes(a: ReadonlyMap<NodeId, Route>, b: ReadonlyMap<NodeId, Route>): boolean {
  if (a.size !== b.size) return false
  for (const [destination, route] of a) {
    const other = b.get(destination)
    if (other === undefined || other.cost !== route.cost || other.nextHop !== route.nextHop)
      return false
  }
  return true
}
