import { dijkstra, forwardingTableFrom } from '../algo/dijkstra.ts'
import type { EdgeId, Graph, NodeId } from '../ds/Graph.ts'
import { sameForwardingTable } from '../sim/convergence.ts'
import type {
  ControlMessage,
  LinkChange,
  Lsa,
  RouteEntry,
  RoutingContext,
  RoutingProtocol,
} from './types.ts'

interface Routes {
  /** Cheapest known cost to each reachable destination. */
  dist: Map<NodeId, number>
  /** Next hop towards each reachable destination. */
  nextHops: Map<NodeId, NodeId>
}

/**
 * Link-state routing with flooding, in the style of OSPF.
 *
 * Every router keeps its own link-state database: the newest advertisement (LSA) it has from
 * every router, each describing that router's own links. From the database it builds its view
 * of the network and runs Dijkstra on it. A link counts as up only if the advertisements of
 * both its routers say so (OSPF's two-way check), so one stale advertisement cannot bring a
 * dead link back.
 *
 * When the routers at a link notice it change, each one originates a new LSA (its sequence
 * number goes up by one) and floods it to its neighbours. A router that receives an LSA newer
 * than the one it holds from that origin stores it, forwards it once to every neighbour except
 * the one it came from, and reruns Dijkstra. Older or duplicate LSAs are ignored, so each LSA is
 * accepted by every router exactly once and flooding stops by itself.
 *
 * When a link comes back up, its two routers also send each other their whole database, so a
 * network that was split in two catches up on everything it missed.
 *
 * Every router starts with every router's first LSA, as if the network had already converged.
 */
export class LinkStateRouting implements RoutingProtocol {
  readonly name = 'link-state'
  /** router -> origin -> the newest LSA the router holds from that origin. */
  private readonly databases = new Map<NodeId, Map<NodeId, Lsa>>()
  private readonly routes = new Map<NodeId, Routes>()
  /** The links and their costs; their up/down state comes from each router's database. */
  private topology: Graph | null = null
  /** How many times each router accepted each LSA, keyed `${origin}#${seq}`, for checking flooding. */
  private readonly receipts = new Map<string, Map<NodeId, number>>()

  /**
   * Gives every router a database holding every router's first LSA, and computes its routes.
   * Time: O(V (V + E) log V): V databases and one Dijkstra per router.
   */
  onStart(ctx: RoutingContext): void {
    this.topology = ctx.knownGraph.clone()
    const firstLsas = ctx.routerIds.map((router) => describeOwnLinks(ctx, router, 0))
    for (const router of ctx.routerIds) {
      const database = new Map<NodeId, Lsa>()
      for (const lsa of firstLsas) {
        database.set(lsa.origin, lsa)
        this.countReceipt(lsa, router)
      }
      this.databases.set(router, database)
      this.routes.set(router, this.computeRoutes(router))
    }
  }

  /**
   * Both routers at the link originate a new LSA and flood it. If the link came up, they also
   * send each other their whole database. Time: O(deg) messages per router, plus Dijkstra.
   */
  onLinkChange(ctx: RoutingContext, change: LinkChange): void {
    for (const router of [change.a, change.b]) this.originate(ctx, router)
    if (change.up) {
      this.sendDatabase(ctx, change.a, change.b)
      this.sendDatabase(ctx, change.b, change.a)
    }
    this.settleIfFloodingDone(ctx)
  }

  /**
   * Accepts the LSAs that are newer than what the router holds, floods those on (to every
   * neighbour except the sender) and reruns Dijkstra if anything was new.
   * Time: O(k) for k LSAs, plus O(deg) messages and one Dijkstra if any were new.
   */
  onControlMessage(
    ctx: RoutingContext,
    router: NodeId,
    from: NodeId,
    message: ControlMessage,
  ): void {
    if (message.kind !== 'lsa') return
    const fresh = message.lsas.filter((lsa) => this.accept(router, lsa))
    if (fresh.length > 0) {
      this.flood(ctx, router, fresh, from)
      this.recompute(ctx, router)
    }
    this.settleIfFloodingDone(ctx)
  }

  /** Link-state sets no timers in this model. Time: O(1). */
  onTimer(): void {}

  /** Time: O(1). */
  getNextHop(router: NodeId, destination: NodeId): NodeId | undefined {
    return this.routes.get(router)?.nextHops.get(destination)
  }

  /** Every reachable destination with its next hop and cost. Time: O(V). */
  routingTable(router: NodeId): RouteEntry[] {
    const routes = this.routes.get(router)
    if (routes === undefined) return []
    const entries: RouteEntry[] = []
    for (const [destination, cost] of routes.dist) {
      if (destination === router || cost === Infinity) continue
      entries.push({
        destination,
        nextHop: routes.nextHops.get(destination) ?? null,
        cost,
        reachable: true,
      })
    }
    return entries
  }

  /** The sequence number of the LSA from `origin` that `router` holds, or undefined. Time: O(1). */
  heldSeq(router: NodeId, origin: NodeId): number | undefined {
    return this.databases.get(router)?.get(origin)?.seq
  }

  /** How many times each router accepted the LSA (`origin`, `seq`). Time: O(V). */
  receiptsOf(origin: NodeId, seq: number): Map<NodeId, number> {
    return new Map(this.receipts.get(`${origin}#${seq}`) ?? [])
  }

  /** `router` makes a new LSA about its own links, stores it, floods it and reruns Dijkstra. */
  private originate(ctx: RoutingContext, router: NodeId): void {
    const seq = (this.heldSeq(router, router) ?? 0) + 1
    const lsa = describeOwnLinks(ctx, router, seq)
    this.accept(router, lsa)
    this.flood(ctx, router, [lsa], null)
    this.recompute(ctx, router)
  }

  /** Stores the LSA if it is newer than the one `router` holds from its origin. O(1). */
  private accept(router: NodeId, lsa: Lsa): boolean {
    const database = this.databases.get(router) as Map<NodeId, Lsa>
    const held = database.get(lsa.origin)
    if (held !== undefined && held.seq >= lsa.seq) return false
    database.set(lsa.origin, lsa)
    this.countReceipt(lsa, router)
    return true
  }

  private countReceipt(lsa: Lsa, router: NodeId): void {
    const key = `${lsa.origin}#${lsa.seq}`
    let counts = this.receipts.get(key)
    if (counts === undefined) {
      counts = new Map()
      this.receipts.set(key, counts)
    }
    counts.set(router, (counts.get(router) ?? 0) + 1)
  }

  /** Sends LSAs to every neighbour the router believes is reachable, except `except`. O(deg). */
  private flood(ctx: RoutingContext, router: NodeId, lsas: Lsa[], except: NodeId | null): void {
    for (const { node: neighbour } of ctx.knownGraph.neighbors(router, { onlyUp: true })) {
      if (neighbour !== except) ctx.sendControl(router, neighbour, { kind: 'lsa', lsas })
    }
  }

  /** Database exchange over a link that just came up. O(V). */
  private sendDatabase(ctx: RoutingContext, from: NodeId, to: NodeId): void {
    const lsas = [...(this.databases.get(from) as Map<NodeId, Lsa>).values()]
    ctx.sendControl(from, to, { kind: 'lsa', lsas })
  }

  /** Reruns Dijkstra for `router`, and reports it if its next hops changed. O((V + E) log V). */
  private recompute(ctx: RoutingContext, router: NodeId): void {
    const next = this.computeRoutes(router)
    const previous = this.routes.get(router)
    this.routes.set(router, next)
    if (previous === undefined || !sameForwardingTable(previous.nextHops, next.nextHops)) {
      ctx.routesChanged(router)
    }
  }

  /**
   * Flooding is over once no LSA is on any link: every router has everything it will get. Then
   * the open link changes are settled. (An LSA lost on a link that goes down meanwhile is
   * covered by the LSAs that link's own failure triggers.) Time: O(C) when settling.
   */
  private settleIfFloodingDone(ctx: RoutingContext): void {
    if (ctx.controlInFlight() === 0) ctx.settleOpenChanges()
  }

  /** Dijkstra over the router's view: links that both ends' LSAs report as up. O((V + E) log V). */
  private computeRoutes(router: NodeId): Routes {
    const view = (this.topology as Graph).clone()
    const database = this.databases.get(router) as Map<NodeId, Lsa>
    const reportsUp = (origin: NodeId, linkId: EdgeId) =>
      database.get(origin)?.links.some(([id, up]) => id === linkId && up) ?? false
    for (const edge of view.edges()) {
      const up = reportsUp(edge.a, edge.id) && reportsUp(edge.b, edge.id)
      if (edge.up !== up) view.setEdgeUp(edge.id, up)
    }
    const { dist, prev } = dijkstra(view, router)
    return { dist, nextHops: forwardingTableFrom(prev, router) }
  }
}

/** An LSA of `router`'s links as the router itself has noticed them. O(deg). */
function describeOwnLinks(ctx: RoutingContext, router: NodeId, seq: number): Lsa {
  const links = ctx.knownGraph.neighbors(router).map(({ edge }) => [edge.id, edge.up] as const)
  return { origin: router, seq, links }
}
