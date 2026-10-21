import { Deque } from '../ds/Deque.ts'
import type { EdgeId, NodeId } from '../ds/Graph.ts'
import { RingBuffer } from '../ds/RingBuffer.ts'
import { DROP_REASONS, PRIORITIES, type DropReason, type Priority } from './Packet.ts'

/** Running totals since the start of the run. */
export interface Counters {
  /** Packets created, by traffic or by sendPacket. */
  generated: number
  delivered: number
  dropped: number
  /** Packets still in the network (queued, transmitting or propagating). */
  inFlight: number
  dropsByReason: Record<DropReason, number>
  /** Sum of (delivery time - creation time) over delivered packets. */
  totalLatencyMs: number
  deliveredByPriority: Record<Priority, number>
  droppedByPriority: Record<Priority, number>
  /** Sum of latencies of delivered packets, per class. */
  latencyByPriority: Record<Priority, number>
}

/** Latency of one traffic class's deliveries in the sliding window. */
export interface ClassLatency {
  count: number
  avgLatencyMs: number | null
  p95LatencyMs: number | null
}

/** Latency and throughput of the packets delivered in the sliding window. */
export interface WindowStats {
  /** Packets delivered in the window. */
  count: number
  /** Mean latency in the window, or null if nothing was delivered. */
  avgLatencyMs: number | null
  /** 95th-percentile latency in the window (nearest rank), or null if nothing was delivered. */
  p95LatencyMs: number | null
  /** Packets delivered per second over the window. */
  throughputPps: number
  /** The same latency figures for each traffic class. */
  byPriority: Record<Priority, ClassLatency>
}

/** Network-wide figures at one STATS_SAMPLE. Counter fields are running totals. */
export interface NetworkSample extends WindowStats {
  time: number
  generated: number
  delivered: number
  dropped: number
  inFlight: number
  /** Packets waiting in all router queues together. */
  queued: number
  dropsByReason: Record<DropReason, number>
}

/** One value of a per-router or per-link time series. */
export interface TimePoint {
  time: number
  value: number
}

interface Delivery {
  time: number
  latencyMs: number
  priority: Priority
}

/** One zero per traffic class. O(1). */
function perPriority(): Record<Priority, number> {
  return { video: 0, web: 0, bulk: 0 }
}

/** Count, mean and p95 of a list of latencies (sorted here). O(n log n). */
function latencyOf(values: number[]): ClassLatency {
  if (values.length === 0) return { count: 0, avgLatencyMs: null, p95LatencyMs: null }
  const sorted = Float64Array.from(values).sort() // typed arrays sort numerically
  const sum = values.reduce((total, value) => total + value, 0)
  return {
    count: values.length,
    avgLatencyMs: sum / values.length,
    p95LatencyMs: percentile(sorted, 95),
  }
}

/** Returns all-zero counters. Time: O(1). */
export function createCounters(): Counters {
  const dropsByReason = {} as Record<DropReason, number>
  for (const reason of DROP_REASONS) dropsByReason[reason] = 0
  return {
    generated: 0,
    delivered: 0,
    dropped: 0,
    inFlight: 0,
    dropsByReason,
    totalLatencyMs: 0,
    deliveredByPriority: perPriority(),
    droppedByPriority: perPriority(),
    latencyByPriority: perPriority(),
  }
}

/** Returns an independent copy, safe to hand out. Time: O(1). */
export function copyCounters(counters: Counters): Counters {
  return {
    ...counters,
    dropsByReason: { ...counters.dropsByReason },
    deliveredByPriority: { ...counters.deliveredByPriority },
    droppedByPriority: { ...counters.droppedByPriority },
    latencyByPriority: { ...counters.latencyByPriority },
  }
}

/**
 * The p-th percentile of `sorted` (ascending, non-empty) by the nearest-rank method: the value
 * at position ceil(p/100 * n), counting from 1. For example, the p95 of 1..20 is 19.
 * Time: O(1).
 */
export function percentile(sorted: ArrayLike<number>, p: number): number {
  const rank = Math.ceil((p / 100) * sorted.length)
  return sorted[Math.max(rank, 1) - 1]
}

/**
 * Collects the statistics of a run:
 * - counters: generated, delivered, dropped by reason, in flight, and per traffic class
 * - a sliding window of recent deliveries (a Deque, oldest at the front) for average and p95
 *   latency, overall and per class, and for throughput
 * - time series, one RingBuffer each in overwrite mode, so only the newest maxSamples are kept:
 *   network-wide samples, queue length per router, and utilisation per link
 */
export class StatsCollector {
  readonly counters: Counters = createCounters()
  readonly windowMs: number
  readonly maxSamples: number
  /** Network-wide samples, oldest first. */
  readonly network: RingBuffer<NetworkSample>
  /** Total queued packets at each router, one point per sample. */
  readonly routerQueues = new Map<NodeId, RingBuffer<TimePoint>>()
  /** Utilisation of each link (its busier direction), one point per sample. */
  readonly linkUtilisation = new Map<EdgeId, RingBuffer<TimePoint>>()
  /** Deliveries in the last windowMs, oldest at the front. */
  private readonly recent = new Deque<Delivery>()
  private lastSample: NetworkSample | null = null

  /**
   * Creates empty stats with a latency window of `windowMs` and time series of `maxSamples`.
   * Time: O(maxSamples) to allocate the network series.
   */
  constructor(windowMs: number, maxSamples: number) {
    this.windowMs = windowMs
    this.maxSamples = maxSamples
    this.network = new RingBuffer<NetworkSample>(maxSamples, 'overwrite')
  }

  /** The most recent sample, or null before the first one. Time: O(1). */
  get latest(): NetworkSample | null {
    return this.lastSample
  }

  /** Counts a new packet. Time: O(1). */
  packetGenerated(): void {
    this.counters.generated++
    this.counters.inFlight++
  }

  /**
   * Counts a delivery at time `now` and adds it to the latency window. Deliveries must be
   * recorded in time order (simulated time never goes back, so they are).
   * Time: O(1) amortised (a Deque push).
   */
  packetDelivered(now: number, latencyMs: number, priority: Priority = 'web'): void {
    this.counters.delivered++
    this.counters.inFlight--
    this.counters.totalLatencyMs += latencyMs
    this.counters.deliveredByPriority[priority]++
    this.counters.latencyByPriority[priority] += latencyMs
    this.recent.pushBack({ time: now, latencyMs, priority })
  }

  /** Counts a drop. Time: O(1). */
  packetDropped(reason: DropReason, priority: Priority = 'web'): void {
    this.counters.dropped++
    this.counters.inFlight--
    this.counters.dropsByReason[reason]++
    this.counters.droppedByPriority[priority]++
  }

  /**
   * Latency and throughput over the window (now - windowMs, now], overall and per traffic
   * class. Deliveries older than that are removed from the front of the Deque first. Before
   * windowMs has passed, the window is [0, now], so throughput divides by the time elapsed.
   * Time: O(w log w) for w deliveries in the window (sorting for the percentiles), plus O(1)
   * amortised for the evictions (each delivery is removed once).
   */
  windowStats(now: number): WindowStats {
    while (
      !this.recent.isEmpty() &&
      (this.recent.peekFront() as Delivery).time <= now - this.windowMs
    ) {
      this.recent.popFront()
    }
    const spanMs = Math.min(this.windowMs, now)
    const throughputPps = spanMs > 0 ? this.recent.size / (spanMs / 1000) : 0
    const all: number[] = []
    const byClass: Record<Priority, number[]> = { video: [], web: [], bulk: [] }
    for (const delivery of this.recent) {
      all.push(delivery.latencyMs)
      byClass[delivery.priority].push(delivery.latencyMs)
    }
    const byPriority = {} as Record<Priority, ClassLatency>
    for (const priority of PRIORITIES) byPriority[priority] = latencyOf(byClass[priority])
    return { ...latencyOf(all), throughputPps, byPriority }
  }

  /**
   * Records one sample at `now`: the network-wide figures, plus a point for each router's queue
   * length and each link's utilisation. Returns the network sample.
   * Time: O(w log w + V + E), see windowStats.
   */
  sample(
    now: number,
    queueLengths: Iterable<[NodeId, number]>,
    utilisation: Iterable<[EdgeId, number]>,
  ): NetworkSample {
    const { generated, delivered, dropped, inFlight } = this.counters
    let queued = 0
    for (const [router, length] of queueLengths) {
      this.seriesFor(this.routerQueues, router).enqueue({ time: now, value: length })
      queued += length
    }
    const sample: NetworkSample = {
      time: now,
      generated,
      delivered,
      dropped,
      inFlight,
      queued,
      dropsByReason: { ...this.counters.dropsByReason },
      ...this.windowStats(now),
    }
    this.network.enqueue(sample)
    this.lastSample = sample
    for (const [link, value] of utilisation) {
      this.seriesFor(this.linkUtilisation, link).enqueue({ time: now, value })
    }
    return sample
  }

  /** The time series for `key`, created empty on first use. O(maxSamples) the first time. */
  private seriesFor<K>(series: Map<K, RingBuffer<TimePoint>>, key: K): RingBuffer<TimePoint> {
    let buffer = series.get(key)
    if (buffer === undefined) {
      buffer = new RingBuffer<TimePoint>(this.maxSamples, 'overwrite')
      series.set(key, buffer)
    }
    return buffer
  }
}
