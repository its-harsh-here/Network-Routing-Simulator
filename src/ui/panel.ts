import type { EdgeId, NodeId } from '../ds/Graph.ts'
import type { ProtocolName, RouteEntry } from '../routing/types.ts'
import type { ConvergenceRecord } from '../sim/convergence.ts'
import type { LogEntry } from '../sim/eventLog.ts'
import type { ControlCounters, Snapshot } from '../sim/Simulator.ts'
import type { Counters, NetworkSample, WindowStats } from '../sim/stats.ts'
import type { NetworkAnalysis } from './analysis.ts'
import type { PacketInspection, PathInspection, RouterInspection } from './inspect.ts'

/** One point of the sparklines under the stats cards. */
export interface HistoryPoint {
  time: number
  /** Delivered / (delivered + dropped) over the last DELIVERY_SPAN samples, or null if none finished. */
  deliveryPct: number | null
  avgLatencyMs: number | null
  p95LatencyMs: number | null
  throughputPps: number
}

/** What the side panel shows. Built a few times a second, never every frame. */
export interface PanelData {
  simTimeMs: number
  counters: Counters
  /** Latency and throughput over the sliding window ending now. */
  window: WindowStats
  /** Delivery % over the whole run, or null before anything finished. */
  overallDeliveryPct: number | null
  linksDown: number
  /** Packets waiting in router queues. */
  queuedPackets: number
  /** Packets on links (being transmitted or travelling). */
  packetsOnLinks: number
  /** The latest link changes, newest first. */
  recentChanges: ConvergenceRecord[]
  /** Recent stats samples for the sparklines, oldest first. */
  history: HistoryPoint[]
  protocol: ProtocolName
  /** Routing control messages sent, delivered and lost so far. */
  control: ControlCounters
  /** Every router's routing table. */
  tables: Record<NodeId, RouteEntry[]>
  inspector: Inspector
  /** MST, bridges and articulation points of the network as it is now. */
  analysis: NetworkAnalysis | null
  /** The event log, oldest first. */
  log: LogEntry[]
  /** The live charts' data. */
  chart: ChartData
}

/** One stats sample, for the charts. Time in seconds. */
export interface ChartPoint {
  t: number
  avg: number | null
  p95: number | null
  throughput: number
  queued: number
}

/** A link going down or up, drawn on the charts as a vertical line. */
export interface ChartMarker {
  id: number
  t: number
  up: boolean
  linkId: EdgeId
}

export interface ChartData {
  /** The x-axis range, in seconds: a fixed-width window that scrolls once the run is long enough. */
  from: number
  to: number
  points: ChartPoint[]
  markers: ChartMarker[]
}

export const NO_CHART: ChartData = { from: 0, to: 0, points: [], markers: [] }

/**
 * The charts' data for the `windowMs` up to `nowMs`: the stats samples, read from the
 * simulator's RingBuffer (which keeps exactly that long), and the link changes in that time.
 * Time: O(samples + changes).
 */
export function chartFrom(
  samples: readonly NetworkSample[],
  changes: readonly ConvergenceRecord[],
  nowMs: number,
  windowMs: number,
): ChartData {
  const fromMs = Math.max(0, nowMs - windowMs)
  const toMs = Math.max(nowMs, windowMs)
  const points = samples
    .filter((s) => s.time >= fromMs)
    .map((s) => ({
      t: s.time / 1000,
      avg: s.avgLatencyMs,
      p95: s.p95LatencyMs,
      throughput: s.throughputPps,
      queued: s.queued,
    }))
  const markers = changes
    .filter((c) => c.changedAt >= fromMs)
    .map((c) => ({ id: c.id, t: c.changedAt / 1000, up: c.up, linkId: c.linkId }))
  return { from: fromMs / 1000, to: toMs / 1000, points, markers }
}

/** What the inspectors show; each is null when there is nothing to show. */
export interface Inspector {
  router: RouterInspection | null
  packet: PacketInspection | null
  path: PathInspection | null
}

export const NO_INSPECTOR: Inspector = { router: null, packet: null, path: null }

/** How many link changes the panel lists. */
export const RECENT_CHANGES = 4
/** How many samples the sparklines show: 60 at 250 ms each is the last 15 seconds. */
export const HISTORY_LENGTH = 60
/** Delivery % is measured over this many samples (1 s at 250 ms each), to smooth it a little. */
export const DELIVERY_SPAN = 4

/** delivered / (delivered + dropped) as a percentage, or null if nothing finished. O(1). */
export function deliveryPercent(delivered: number, dropped: number): number | null {
  const finished = delivered + dropped
  return finished === 0 ? null : (100 * delivered) / finished
}

/**
 * Sparkline points from consecutive samples. Counters in samples are running totals, so the
 * delivery % at sample i comes from the change since sample i - DELIVERY_SPAN.
 * Time: O(n).
 */
export function historyFrom(samples: readonly NetworkSample[]): HistoryPoint[] {
  return samples.map((sample, i) => {
    const base = samples[Math.max(0, i - DELIVERY_SPAN)]
    const deliveryPct =
      base === sample
        ? null
        : deliveryPercent(sample.delivered - base.delivered, sample.dropped - base.dropped)
    return {
      time: sample.time,
      deliveryPct,
      avgLatencyMs: sample.avgLatencyMs,
      p95LatencyMs: sample.p95LatencyMs,
      throughputPps: sample.throughputPps,
    }
  })
}

/**
 * Collects the panel figures from a snapshot, the current window stats, the recent samples and
 * the routing tables.
 * Time: O(V + E + C + samples).
 */
export function buildPanelData(
  snapshot: Snapshot,
  window: WindowStats,
  samples: readonly NetworkSample[] = [],
  tables: Record<NodeId, RouteEntry[]> = {},
  more: Partial<Pick<PanelData, 'inspector' | 'analysis' | 'log' | 'chart'>> = {},
): PanelData {
  const counters = snapshot.stats
  return {
    simTimeMs: snapshot.time,
    counters,
    window,
    overallDeliveryPct: deliveryPercent(counters.delivered, counters.dropped),
    linksDown: snapshot.links.filter((link) => !link.up).length,
    queuedPackets: snapshot.routers.reduce((sum, router) => sum + router.queued, 0),
    packetsOnLinks: snapshot.packets.length,
    recentChanges: snapshot.convergence.slice(-RECENT_CHANGES).reverse(),
    history: historyFrom(samples.slice(-(HISTORY_LENGTH + DELIVERY_SPAN))).slice(-HISTORY_LENGTH),
    protocol: snapshot.protocol,
    control: snapshot.control,
    tables,
    inspector: more.inspector ?? NO_INSPECTOR,
    analysis: more.analysis ?? null,
    log: more.log ?? [],
    chart: more.chart ?? NO_CHART,
  }
}
