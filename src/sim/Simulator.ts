import type { EdgeId, Graph, NodeId } from '../ds/Graph.ts'
import { createRoutingProtocol } from '../routing/index.ts'
import type {
  ControlMessage,
  ProtocolName,
  RouteEntry,
  RoutingContext,
  RoutingProtocol,
} from '../routing/types.ts'
import { resolveConfig, type SimConfig } from './config.ts'
import { createConvergenceRecord, type ConvergenceRecord } from './convergence.ts'
import { EventLog } from './eventLog.ts'
import { EventQueue, type ScheduledEvent } from './EventQueue.ts'
import type { SimEvent } from './events.ts'
import { Link, type LinkDirection } from './Link.ts'
import {
  DROP_REASONS,
  type DropReason,
  type Packet,
  type PacketStatus,
  type Priority,
} from './Packet.ts'
import { Rng } from './rng.ts'
import { Router } from './Router.ts'
import { copyCounters, StatsCollector, type Counters, type NetworkSample } from './stats.ts'
import { interArrivalMs, pickPriority, randomPair } from './traffic.ts'

/** Settings for one sendPacket call. Anything left out comes from the config. */
export interface SendOptions {
  /** Defaults to 'web'. */
  priority?: Priority
  /** Defaults to config.packetSizeBytes[priority]. */
  sizeBytes?: number
  /** Defaults to config.defaultTtl. */
  ttl?: number
}

/** One direction of a link, as plain data. */
export interface DirectionSnapshot {
  from: NodeId
  to: NodeId
  busy: boolean
  /** Packets waiting in the output queue at `from` for this direction. */
  queueLength: number
  /** Busy fraction of the last stats window, from 0 to 1. */
  utilisation: number
}

export interface LinkSnapshot {
  id: EdgeId
  a: NodeId
  b: NodeId
  up: boolean
  cost: number
  bandwidthBps: number
  delayMs: number
  aToB: DirectionSnapshot
  bToA: DirectionSnapshot
}

export interface RouterSnapshot {
  id: NodeId
  /** Total packets waiting in all of this router's output queues. */
  queued: number
  /** Queue length towards each neighbour. */
  queueLengths: Record<NodeId, number>
}

/** A packet on a link, from the start of its transmission until it reaches the far end. */
export interface PacketSnapshot {
  id: number
  src: NodeId
  dst: NodeId
  priority: Priority
  status: PacketStatus
  linkId: EdgeId
  from: NodeId
  to: NodeId
  /** When transmission started at `from`. */
  departTime: number
  /** When the last bit reaches `to`: departTime + transmission time + propagation delay. */
  arriveTime: number
}

/** A routing control message on a link. */
export interface ControlSnapshot {
  id: number
  linkId: EdgeId
  from: NodeId
  to: NodeId
  departTime: number
  /** departTime + the link's delay: control messages skip the data queues. */
  arriveTime: number
}

/** How many routing control messages were sent, arrived, and were lost on links that were down. */
export interface ControlCounters {
  sent: number
  delivered: number
  lost: number
}

/** Everything needed to draw the network at one moment. Plain data, safe to postMessage. */
export interface Snapshot {
  time: number
  routers: RouterSnapshot[]
  links: LinkSnapshot[]
  packets: PacketSnapshot[]
  stats: Counters
  /** The most recent stats sample (latency, throughput), or null before the first. */
  latestSample: NetworkSample | null
  convergence: ConvergenceRecord[]
  protocol: ProtocolName
  controlMessages: ControlSnapshot[]
  control: ControlCounters
}

/** A routing control message travelling along a link. */
interface ControlFlight extends ControlSnapshot {
  message: ControlMessage
}

/** A packet that is on a link: being transmitted or propagating. */
interface Flight {
  packet: Packet
  linkId: EdgeId
  from: NodeId
  to: NodeId
  departTime: number
  arriveTime: number
}

/**
 * Discrete-event network simulator. Time jumps from one event to the next: the earliest event
 * is taken from the EventQueue, `now` is set to its time, and its handler runs. Handlers change
 * state and schedule further events. No DOM or React, so it runs in tests, Node or a Web Worker.
 *
 * A packet's journey:
 * 1. It arrives at a router: at its source when created, then at each router a link delivers it to.
 * 2. The router delivers it, drops it, or decrements its TTL and puts it in the output queue
 *    towards the next hop the routing protocol chose (dropping it if that queue is full).
 * 3. When the link in that direction is up and idle, the head of the queue is transmitted.
 *    TX_COMPLETE fires after sizeBytes * 8 / bandwidthBps, frees the link for the next queued
 *    packet, and schedules PACKET_ARRIVE at the far end delayMs later.
 *
 * Routing is a pluggable RoutingProtocol (link-state or distance-vector). The simulator gives it
 * a RoutingContext for sending control messages, setting timers and reporting route changes.
 *
 * Link failures and convergence:
 * - LINK_DOWN marks the edge down. Packets on the link (being transmitted or travelling along
 *   it) are dropped with 'link-failure'. Their pending TX_COMPLETE and PACKET_ARRIVE events are
 *   ignored when they come out of the queue: lazy deletion, as in Dijkstra.
 * - Packets queued for the link stay queued. Until routes change, routers keep using the old
 *   forwarding tables, so more packets can pile up there.
 * - detectionDelayMs later the two routers next to the link notice (LINK_CHANGE_DETECTED): the
 *   change enters knownGraph, the link states the routers know about, and the protocol reacts.
 *   Whenever routes change, packets stranded in the queue of a down link are re-forwarded, or
 *   dropped if there is no route. LINK_UP goes through the same detection step.
 * - Routing control messages travel with the link's delay and skip the data queues. One on a
 *   link that goes down is lost; its CONTROL_ARRIVE is ignored when it comes out of the queue.
 */
export class Simulator {
  /** The real topology (the simulator's own copy): links go down and up here at once. */
  readonly graph: Graph
  /**
   * The link states the routers know about: a link change reaches this graph only when the
   * routers at its ends detect it. Routing protocols work from this, never from `graph`.
   */
  readonly knownGraph: Graph
  /** The routing protocol the routers run. */
  readonly routing: RoutingProtocol
  /** Routing control message counts. Read them freely; only the simulator writes. */
  readonly control: ControlCounters = { sent: 0, delivered: 0, lost: 0 }
  readonly config: SimConfig
  readonly routers = new Map<NodeId, Router>()
  readonly links = new Map<EdgeId, Link>()
  readonly eventQueue = new EventQueue<SimEvent>()
  /** Counters, latency window and time series. Read them freely; only the simulator writes. */
  readonly stats: StatsCollector
  private readonly rng: Rng
  private readonly routerIds: NodeId[]
  private currentTime = 0
  private nextPacketId = 1
  /** Packets not yet delivered or dropped, by id. */
  private readonly livePackets = new Map<number, Packet>()
  /** Packets currently on a link, by id. */
  private readonly flights = new Map<number, Flight>()
  /** One record per link change, indexed by its id. */
  private readonly changes: ConvergenceRecord[] = []
  /** The newest notable events: link changes, convergence, drop summaries, counting steps. */
  readonly log = new EventLog()
  /** Drops not yet summed up in the log, by reason, and when the first of them happened. */
  private pendingDrops: Record<DropReason, number> = noDrops()
  private pendingDropsSince = 0
  /**
   * Every route's last cost, and how often it has risen since the last link change was
   * noticed (distance-vector only): a route that keeps rising is counting to infinity.
   */
  private readonly routeCosts = new Map<string, number>()
  private routeRises = new Map<string, number>()
  /**
   * Which chain of GENERATE_PACKET events is current. setTraffic starts a new chain, and events
   * from older chains are ignored when they come out of the queue.
   */
  private trafficChain = 0
  /** Routing control messages on links, by id. */
  private readonly controlFlights = new Map<number, ControlFlight>()
  private nextControlId = 1
  /** Set when routes changed while handling an event, so stranded packets get re-forwarded. */
  private routesDirty = false
  /** The protocol's window onto the simulator. */
  private readonly ctx: RoutingContext

  /**
   * Sets up routers and links for a copy of `graph`, starts the routing protocol, then schedules
   * the first GENERATE_PACKET and STATS_SAMPLE (unless turned off in the config).
   * Time: O(V * queueCapacity) for the queues, plus the protocol's start: O(V (V + E) log V) for
   * link-state, O(V * deg) for distance-vector.
   * @throws RangeError if a config value is invalid.
   */
  constructor(graph: Graph, config: Partial<SimConfig> = {}) {
    this.graph = graph.clone()
    this.knownGraph = graph.clone()
    this.config = resolveConfig(config)
    this.rng = new Rng(this.config.seed)
    this.stats = new StatsCollector(this.config.latencyWindowMs, this.config.maxSamples)

    for (const edge of this.graph.edges()) this.links.set(edge.id, new Link(edge))
    this.routerIds = this.graph.nodes()
    for (const id of this.routerIds) {
      const neighbours = this.graph.neighbors(id).map((neighbor) => neighbor.node)
      const disciplineFor = (neighbour: NodeId) => {
        const linkId = (this.graph.edgeBetween(id, neighbour) as { id: EdgeId }).id
        return this.config.linkQueueDiscipline[linkId] ?? this.config.queueDiscipline
      }
      this.routers.set(id, new Router(id, neighbours, this.config.queueCapacity, disciplineFor))
    }

    this.ctx = {
      now: () => this.currentTime,
      routerIds: this.routerIds,
      knownGraph: this.knownGraph,
      sendControl: (from, to, message) => this.sendControl(from, to, message),
      controlInFlight: () => this.controlFlights.size,
      setTimer: (delayMs, timer) =>
        this.schedule(this.currentTime + delayMs, { type: 'ROUTING_TIMER', timer }),
      routesChanged: (router) => this.creditRouteChange(router),
      settleChange: (changeId) => this.settle(this.changes[changeId]),
      settleOpenChanges: () => {
        for (const change of this.changes) if (change.detectedAt !== null) this.settle(change)
      },
    }
    this.routing = createRoutingProtocol(this.config)
    this.routing.onStart(this.ctx)
    this.routesDirty = false

    this.startTraffic()
    if (this.config.statsIntervalMs > 0) {
      this.schedule(this.config.statsIntervalMs, { type: 'STATS_SAMPLE' })
    }
  }

  /**
   * How many times a link has gone down or up so far. It changes exactly when the network's
   * link states do, so a view can recompute its analysis only then. Time: O(1).
   */
  get linkChangeCount(): number {
    return this.changes.length
  }

  /** Current simulated time in ms. Time: O(1). */
  get now(): number {
    return this.currentTime
  }

  /**
   * Changes the traffic while the simulation runs; 0 packets per second turns it off. The next
   * packet is timed afresh from the new rate. Exponential gaps are memoryless, so restarting the
   * clock keeps the stream Poisson. The GENERATE_PACKET still pending from the old setting stays
   * in the queue and is ignored when it comes out (lazy deletion again).
   * Time: O(log n).
   * @throws RangeError if the rate or the mix is invalid; nothing changes in that case.
   */
  setTraffic(
    packetsPerSecond: number,
    priorityMix: Record<Priority, number> = this.config.priorityMix,
  ): void {
    const checked = resolveConfig({ ...this.config, packetsPerSecond, priorityMix })
    this.config.packetsPerSecond = checked.packetsPerSecond
    this.config.priorityMix = { ...checked.priorityMix }
    this.trafficChain++
    this.startTraffic()
  }

  /** The next hop `router` uses for `destination`, or undefined if it has no route. Time: O(1). */
  nextHop(router: NodeId, destination: NodeId): NodeId | undefined {
    return this.routing.getNextHop(router, destination)
  }

  /** Every router's routing table, as plain data. Time: O(V^2). */
  routingTables(): Record<NodeId, RouteEntry[]> {
    const tables: Record<NodeId, RouteEntry[]> = {}
    for (const router of this.routerIds) tables[router] = this.routing.routingTable(router)
    return tables
  }

  /** Copies of the link change records, oldest first. Time: O(number of changes). */
  convergenceRecords(): ConvergenceRecord[] {
    return this.changes.map((record) => ({ ...record }))
  }

  /**
   * Schedules `event` at `time`. Use it to plan LINK_DOWN and LINK_UP events.
   * Time: O(log n) for n pending events.
   * @throws RangeError if time is earlier than now. Error if a link event names an unknown link.
   */
  schedule(time: number, event: SimEvent): void {
    if (!(time >= this.currentTime)) {
      throw new RangeError(`cannot schedule at ${time}, which is before now (${this.currentTime})`)
    }
    if ((event.type === 'LINK_DOWN' || event.type === 'LINK_UP') && !this.links.has(event.linkId)) {
      throw new Error(`unknown link "${event.linkId}"`)
    }
    this.eventQueue.schedule(time, event)
  }

  /**
   * Processes exactly one event: the earliest one. Returns it, or undefined if none are left.
   * Time: O(log n) for the queue, plus the handler: O(1) amortised for packet events, O(P) for
   * a LINK_DOWN (P packets on links), and whatever the routing protocol does for its events.
   */
  step(): ScheduledEvent<SimEvent> | undefined {
    const next = this.eventQueue.next()
    if (next === undefined) return undefined
    this.currentTime = next.time
    this.handle(next.event)
    return next
  }

  /**
   * Processes every event with time <= `time`, in order, then sets now to `time`.
   * Time: O(k log n) for k processed events, plus their handlers.
   * @throws RangeError if `time` is earlier than now.
   */
  runUntil(time: number): void {
    this.advanceUntil(time, Infinity)
  }

  /**
   * Like runUntil, but processes at most `maxEvents` events, so a caller such as an animation
   * frame can bound its work. Returns true if it reached `time` (and set now to it). Returns
   * false if it stopped early, leaving now at the time of the last event processed.
   * Time: O(min(k, maxEvents) log n), plus the handlers.
   * @throws RangeError if `time` is earlier than now.
   */
  advanceUntil(time: number, maxEvents: number): boolean {
    if (!(time >= this.currentTime)) {
      throw new RangeError(`cannot run until ${time}, which is before now (${this.currentTime})`)
    }
    let processed = 0
    while (this.eventQueue.size > 0 && (this.eventQueue.peekTime() as number) <= time) {
      if (processed >= maxEvents) return false
      this.step()
      processed++
    }
    this.currentTime = time
    return true
  }

  /**
   * Creates a packet now and hands it to its source router. Returns the packet, which the
   * simulator keeps updating (status, hops, finishedAt), so callers can watch it.
   * Time: O(log n), as the source may start a transmission.
   * @throws Error if a router is unknown or src === dst. RangeError if sizeBytes or ttl is invalid.
   */
  sendPacket(src: NodeId, dst: NodeId, options: SendOptions = {}): Packet {
    if (!this.routers.has(src)) throw new Error(`unknown router "${src}"`)
    if (!this.routers.has(dst)) throw new Error(`unknown router "${dst}"`)
    if (src === dst) throw new Error('a packet needs a destination different from its source')
    const priority = options.priority ?? 'web'
    const sizeBytes = options.sizeBytes ?? this.config.packetSizeBytes[priority]
    const ttl = options.ttl ?? this.config.defaultTtl
    if (!(Number.isFinite(sizeBytes) && sizeBytes > 0)) {
      throw new RangeError(`sizeBytes must be > 0, got ${sizeBytes}`)
    }
    if (!(Number.isInteger(ttl) && ttl >= 0)) {
      throw new RangeError(`ttl must be an integer >= 0, got ${ttl}`)
    }

    const packet: Packet = {
      id: this.nextPacketId++,
      src,
      dst,
      sizeBytes,
      priority,
      createdAt: this.currentTime,
      ttl,
      hops: [],
      status: 'queued',
    }
    this.livePackets.set(packet.id, packet)
    this.stats.packetGenerated()
    this.routerAt(src).counters.originated++
    this.arrive(packet, src)
    return packet
  }

  /**
   * A packet that is still in the network (queued or on a link), by id, or undefined if it has
   * been delivered or dropped. The simulator keeps updating the object it returns. Time: O(1).
   */
  findPacket(id: number): Packet | undefined {
    return this.livePackets.get(id)
  }

  /**
   * Plain-data picture of the network now: routers with queue lengths, links with utilisation
   * and up/down state, packets and control messages on links, counters, the latest sample and
   * link change records.
   * Time: O(V + E + P + M + C) for P packets and M control messages on links, C link changes.
   */
  snapshot(): Snapshot {
    const routers = [...this.routers.values()].map((router) => ({
      id: router.id,
      queued: router.queuedCount,
      queueLengths: router.queueLengths(),
    }))
    const links = [...this.links.values()].map((link) => ({
      id: link.id,
      a: link.edge.a,
      b: link.edge.b,
      up: link.up,
      cost: link.edge.cost,
      bandwidthBps: link.edge.bandwidthBps,
      delayMs: link.edge.delayMs,
      aToB: this.directionSnapshot(link.aToB),
      bToA: this.directionSnapshot(link.bToA),
    }))
    const packets = [...this.flights.values()].map((flight) => ({
      id: flight.packet.id,
      src: flight.packet.src,
      dst: flight.packet.dst,
      priority: flight.packet.priority,
      status: flight.packet.status,
      linkId: flight.linkId,
      from: flight.from,
      to: flight.to,
      departTime: flight.departTime,
      arriveTime: flight.arriveTime,
    }))
    const latest = this.stats.latest
    return {
      time: this.currentTime,
      routers,
      links,
      packets,
      stats: copyCounters(this.stats.counters),
      latestSample:
        latest === null ? null : { ...latest, dropsByReason: { ...latest.dropsByReason } },
      convergence: this.convergenceRecords(),
      protocol: this.routing.name,
      controlMessages: [...this.controlFlights.values()].map(
        ({ id, linkId, from, to, departTime, arriveTime }) => ({
          id,
          linkId,
          from,
          to,
          departTime,
          arriveTime,
        }),
      ),
      control: { ...this.control },
    }
  }

  /** Runs the handler for one event. */
  private handle(event: SimEvent): void {
    switch (event.type) {
      case 'GENERATE_PACKET':
        if (event.chain !== this.trafficChain) return // stale: the traffic settings changed
        return this.generatePacket()
      case 'PACKET_ARRIVE': {
        const packet = this.livePackets.get(event.packetId)
        if (packet === undefined) return // stale: the packet was dropped while on the link
        this.flights.delete(packet.id)
        return this.arrive(packet, event.router)
      }
      case 'TX_COMPLETE':
        return this.completeTransmission(event.linkId, event.from, event.packetId)
      case 'LINK_DOWN':
        return this.setLinkUp(event.linkId, false)
      case 'LINK_UP':
        return this.setLinkUp(event.linkId, true)
      case 'LINK_CHANGE_DETECTED':
        return this.detectChange(this.changes[event.changeId])
      case 'ROUTING_TIMER':
        this.routing.onTimer(this.ctx, event.timer)
        return this.afterRouting()
      case 'CONTROL_ARRIVE':
        return this.deliverControl(event.messageId)
      case 'STATS_SAMPLE':
        return this.sampleStats()
      default: {
        const unhandled: never = event
        throw new Error(`unhandled event ${JSON.stringify(unhandled)}`)
      }
    }
  }

  /** Poisson traffic: one packet between a random pair of routers, then the next arrival. */
  private generatePacket(): void {
    if (this.routerIds.length >= 2) {
      const { src, dst } = randomPair(this.rng, this.routerIds)
      const priority = pickPriority(this.rng, this.config.priorityMix)
      this.sendPacket(src, dst, { priority })
    }
    this.startTraffic()
  }

  /** Schedules the next GENERATE_PACKET of the current chain, unless traffic is off. O(log n). */
  private startTraffic(): void {
    if (this.config.packetsPerSecond <= 0) return
    const gap = interArrivalMs(this.rng, this.config.packetsPerSecond)
    this.schedule(this.currentTime + gap, { type: 'GENERATE_PACKET', chain: this.trafficChain })
  }

  /** `packet` has arrived at `routerId`: deliver it, drop it, or queue it towards the next hop. */
  private arrive(packet: Packet, routerId: NodeId): void {
    const router = this.routers.get(routerId) as Router
    packet.hops.push(routerId)

    const decision = router.route(packet, this.routing.getNextHop(routerId, packet.dst))
    if (decision.kind === 'deliver') return this.deliver(packet)
    if (decision.kind === 'drop') return this.drop(packet, decision.reason)
    packet.ttl--
    this.enqueue(packet, router, decision.nextHop)
  }

  /**
   * Offers `packet` to the queue from `router` to `nextHop` and starts sending if possible. A full
   * queue drops a packet: the offered one, or (priority queues) a lower-priority one it evicts.
   */
  private enqueue(packet: Packet, router: Router, nextHop: NodeId): void {
    const { accepted, dropped } = router.queueTo(nextHop).enqueue(packet)
    if (dropped !== null) this.drop(dropped, 'queue-full')
    if (!accepted) return
    packet.status = 'queued'
    this.startSendingIfIdle(router.id, nextHop)
  }

  /** If the link from -> to is up and idle, starts transmitting the head of its output queue. */
  private startSendingIfIdle(from: NodeId, to: NodeId): void {
    const link = this.linkBetween(from, to)
    const direction = link.direction(from)
    if (!link.up || direction.busy) return
    const router = this.routers.get(from) as Router
    const packet = router.queueTo(to).dequeue()
    if (packet === undefined) return
    router.counters.forwarded++

    const txMs = link.transmissionTimeMs(packet.sizeBytes)
    direction.startSending(packet, this.currentTime)
    packet.status = 'transmitting'
    this.flights.set(packet.id, {
      packet,
      linkId: link.id,
      from,
      to,
      departTime: this.currentTime,
      arriveTime: this.currentTime + txMs + link.edge.delayMs,
    })
    this.schedule(this.currentTime + txMs, {
      type: 'TX_COMPLETE',
      linkId: link.id,
      from,
      packetId: packet.id,
    })
  }

  /** The last bit is on the wire: send it on its way and start the next queued packet. */
  private completeTransmission(linkId: EdgeId, from: NodeId, packetId: number): void {
    const link = this.links.get(linkId) as Link
    const direction = link.direction(from)
    // Stale if the link went down mid-transmission (and maybe came back with a new packet).
    if (direction.sending?.id !== packetId) return

    const packet = direction.finishSending(this.currentTime)
    packet.status = 'propagating'
    this.schedule(this.currentTime + link.edge.delayMs, {
      type: 'PACKET_ARRIVE',
      packetId: packet.id,
      router: direction.to,
    })
    this.startSendingIfIdle(from, direction.to)
  }

  /**
   * Marks a link down or up and starts the network's reaction: a convergence record, and
   * LINK_CHANGE_DETECTED after detectionDelayMs. Going down drops the packets on the link;
   * coming up lets queued packets go straight away.
   */
  private setLinkUp(linkId: EdgeId, up: boolean): void {
    const link = this.links.get(linkId) as Link
    if (link.up === up) return
    link.edge = this.graph.setEdgeUp(linkId, up)

    const record = createConvergenceRecord(this.changes.length, linkId, up, this.currentTime)
    this.changes.push(record)
    this.log.add(this.currentTime, 'link', `Link ${linkId} ${up ? 'restored' : 'cut'}`)
    this.schedule(this.currentTime + this.config.detectionDelayMs, {
      type: 'LINK_CHANGE_DETECTED',
      changeId: record.id,
    })

    if (up) {
      this.startSendingIfIdle(link.edge.a, link.edge.b)
      this.startSendingIfIdle(link.edge.b, link.edge.a)
      return
    }
    for (const direction of [link.aToB, link.bToA]) {
      if (direction.busy) this.drop(direction.finishSending(this.currentTime), 'link-failure')
    }
    // Packets already fully sent and still travelling along the link are lost too.
    for (const flight of [...this.flights.values()]) {
      if (flight.linkId === linkId) this.drop(flight.packet, 'link-failure')
    }
    // So are routing messages on it.
    for (const message of [...this.controlFlights.values()]) {
      if (message.linkId !== linkId) continue
      this.controlFlights.delete(message.id)
      this.control.lost++
    }
  }

  /**
   * The routers at the link have noticed the change: it enters knownGraph and the routing
   * protocol reacts (link-state floods new LSAs; distance-vector updates those two routers).
   */
  private detectChange(record: ConvergenceRecord): void {
    record.detectedAt = this.currentTime
    record.detectionMs = this.currentTime - record.changedAt
    const edge = this.knownGraph.setEdgeUp(record.linkId, record.up)
    this.log.add(
      this.currentTime,
      'link',
      `${edge.a} and ${edge.b} noticed that ${record.linkId} is ${record.up ? 'up' : 'down'}`,
    )
    this.routeRises = new Map() // counting starts afresh after each change
    this.routing.onLinkChange(this.ctx, {
      changeId: record.id,
      linkId: record.linkId,
      a: edge.a,
      b: edge.b,
      up: record.up,
    })
    this.afterRouting()
  }

  /**
   * A router's routes changed. Every link change that is detected but not settled is still
   * converging, so the change counts towards it: its last table change is now. O(C), plus O(V)
   * under distance-vector to look for counting to infinity.
   */
  private creditRouteChange(router: NodeId): void {
    this.routesDirty = true
    if (this.routing.name === 'distance-vector') this.watchForCounting(router)
    for (const change of this.changes) {
      if (change.detectedAt === null || change.settledAt !== null) continue
      change.tablesChanged++
      change.lastTableChangeAt = this.currentTime
      change.convergenceMs = this.currentTime - change.changedAt
    }
  }

  /**
   * Logs each step of counting to infinity: after a link change, a route whose cost rises a
   * second time (or more) is learning bad news one update at a time. The first rise is not
   * logged, as one rise is a normal reroute. O(V) for the router's table.
   */
  private watchForCounting(router: NodeId): void {
    for (const entry of this.routing.routingTable(router)) {
      const key = `${router}>${entry.destination}`
      const before = this.routeCosts.get(key)
      this.routeCosts.set(key, entry.cost)
      if (before === undefined || entry.cost <= before) continue
      const rises = (this.routeRises.get(key) ?? 0) + 1
      this.routeRises.set(key, rises)
      if (rises < 2) continue
      this.log.add(
        this.currentTime,
        'counting',
        entry.reachable
          ? `${router}: cost to ${entry.destination} rose ${before} → ${entry.cost} via ${entry.nextHop}`
          : `${router}: ${entry.destination} unreachable after ${rises} rises (cost ${entry.cost} = infinity)`,
      )
    }
  }

  /** Link changes that have happened but not settled yet: the network is still reacting. O(C). */
  private openChanges(): ConvergenceRecord[] {
    return this.changes.filter((change) => change.settledAt === null)
  }

  /** Marks a link change as settled, if it is not already. O(1). */
  private settle(change: ConvergenceRecord | undefined): void {
    if (change === undefined || change.settledAt !== null) return
    change.settledAt = this.currentTime
    const what = `${change.linkId} went ${change.up ? 'up' : 'down'}`
    this.log.add(
      this.currentTime,
      'convergence',
      change.convergenceMs === null
        ? `Settled after ${what}: no route had to change`
        : `Converged ${change.convergenceMs} ms after ${what}: ` +
            `${plural(change.packetsLost, 'packet')} lost, ` +
            `${plural(change.controlMessagesSent, 'routing message')}`,
    )
  }

  /**
   * Sums up the drops of the last second or so in one log entry, rather than one per drop,
   * which would flood the log. Called on every drop and stats sample. O(reasons).
   */
  private logDrops(): void {
    const total = DROP_REASONS.reduce((sum, reason) => sum + this.pendingDrops[reason], 0)
    if (total === 0 || this.currentTime - this.pendingDropsSince < DROP_SUMMARY_MS) return
    const reasons = DROP_REASONS.filter((reason) => this.pendingDrops[reason] > 0)
      .map((reason) => `${reason} ${this.pendingDrops[reason]}`)
      .join(', ')
    const seconds = ((this.currentTime - this.pendingDropsSince) / 1000).toFixed(1)
    this.log.add(
      this.currentTime,
      'drops',
      `${plural(total, 'packet')} dropped in ${seconds} s: ${reasons}`,
    )
    this.pendingDrops = noDrops()
  }

  /** After the protocol has handled something: if routes changed, re-forward stranded packets. */
  private afterRouting(): void {
    if (!this.routesDirty) return
    this.routesDirty = false
    this.reforwardStranded()
  }

  /** Puts a routing message on the link from `from` to `to`, or counts it lost if the link is down. */
  private sendControl(from: NodeId, to: NodeId, message: ControlMessage): void {
    this.control.sent++
    for (const change of this.openChanges()) change.controlMessagesSent++
    const link = this.linkBetween(from, to)
    if (!link.up) {
      this.control.lost++
      return
    }
    const id = this.nextControlId++
    const arriveTime = this.currentTime + link.edge.delayMs
    this.controlFlights.set(id, {
      id,
      linkId: link.id,
      from,
      to,
      departTime: this.currentTime,
      arriveTime,
      message,
    })
    this.schedule(arriveTime, { type: 'CONTROL_ARRIVE', messageId: id })
  }

  /** Hands an arriving routing message to the protocol, unless it was lost on the way. */
  private deliverControl(messageId: number): void {
    const flight = this.controlFlights.get(messageId)
    if (flight === undefined) return // stale: lost when its link went down
    this.controlFlights.delete(messageId)
    this.control.delivered++
    this.routing.onControlMessage(this.ctx, flight.to, flight.from, flight.message)
    this.afterRouting()
  }

  /** Moves packets out of the queues of down links using the protocol's current routes. */
  private reforwardStranded(): void {
    for (const router of this.routers.values()) {
      for (const neighbour of router.neighbours()) {
        if (this.linkBetween(router.id, neighbour).up) continue
        const queue = router.queueTo(neighbour)
        const stranded: Packet[] = []
        while (!queue.isEmpty()) stranded.push(queue.dequeue() as Packet)
        for (const packet of stranded) {
          // The TTL was already decremented when this router first forwarded the packet.
          const nextHop = this.routing.getNextHop(router.id, packet.dst)
          if (nextHop === undefined) this.drop(packet, 'no-route')
          else this.enqueue(packet, router, nextHop)
        }
      }
    }
  }

  /** Records a stats sample: link utilisation windows end here, then the network figures. */
  private sampleStats(): void {
    const utilisation: [EdgeId, number][] = []
    for (const link of this.links.values()) {
      link.aToB.closeWindow(this.currentTime)
      link.bToA.closeWindow(this.currentTime)
      utilisation.push([link.id, Math.max(link.aToB.utilisation, link.bToA.utilisation)])
    }
    const queueLengths: [NodeId, number][] = [...this.routers.values()].map((router) => [
      router.id,
      router.queuedCount,
    ])
    this.stats.sample(this.currentTime, queueLengths, utilisation)
    this.logDrops()
    this.schedule(this.currentTime + this.config.statsIntervalMs, { type: 'STATS_SAMPLE' })
  }

  private deliver(packet: Packet): void {
    this.routerAt(packet.dst).counters.delivered++
    packet.status = 'delivered'
    packet.finishedAt = this.currentTime
    this.stats.packetDelivered(
      this.currentTime,
      this.currentTime - packet.createdAt,
      packet.priority,
    )
    this.retire(packet)
  }

  private drop(packet: Packet, reason: DropReason): void {
    // The last router the packet reached is where it was dropped: it was queued or being sent
    // there, or that router found no route for it.
    const at = packet.hops[packet.hops.length - 1]
    this.routerAt(at).counters.dropped++
    packet.status = 'dropped'
    packet.dropReason = reason
    packet.finishedAt = this.currentTime
    this.stats.packetDropped(reason, packet.priority)
    for (const change of this.openChanges()) change.packetsLost++
    if (DROP_REASONS.every((r) => this.pendingDrops[r] === 0))
      this.pendingDropsSince = this.currentTime
    this.pendingDrops[reason]++
    this.logDrops()
    this.retire(packet)
  }

  /** Forgets a finished packet, so stale events about it are ignored. */
  private retire(packet: Packet): void {
    this.livePackets.delete(packet.id)
    this.flights.delete(packet.id)
  }

  /** The router with this id, which must exist. O(1). */
  private routerAt(id: NodeId): Router {
    return this.routers.get(id) as Router
  }

  private linkBetween(a: NodeId, b: NodeId): Link {
    const edge = this.graph.edgeBetween(a, b)
    if (edge === undefined) throw new Error(`no link between ${a} and ${b}`)
    return this.links.get(edge.id) as Link
  }

  private directionSnapshot(direction: LinkDirection): DirectionSnapshot {
    return {
      from: direction.from,
      to: direction.to,
      busy: direction.busy,
      queueLength: (this.routers.get(direction.from) as Router).queueTo(direction.to).size,
      utilisation: direction.utilisation,
    }
  }
}

/** Drops are summed up in the log at most once per this many ms. */
const DROP_SUMMARY_MS = 1_000

function noDrops(): Record<DropReason, number> {
  return { 'ttl-expired': 0, 'no-route': 0, 'queue-full': 0, 'link-failure': 0 }
}

/** "1 packet", "3 packets". O(1). */
function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}
