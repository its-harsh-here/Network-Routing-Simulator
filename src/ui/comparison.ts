// Protocol comparison: runs the same failure scenario, with the same seed, once under link-state
// and once under distance-vector, and collects what each protocol did. Pure TypeScript with no
// DOM, so it runs in tests and in the comparison Web Worker.
import { bfs } from '../algo/bfs.ts'
import type { EdgeId } from '../ds/Graph.ts'
import { PROTOCOL_NAMES, type ProtocolName } from '../routing/types.ts'
import { busiestLinkNow } from '../sim/runner.ts'
import type { Simulator } from '../sim/Simulator.ts'
import { copyCounters, type Counters } from '../sim/stats.ts'
import { readTopologyFile, type TopologyFile } from '../topology/json.ts'
import { simulationFor, type LiveSettings, type TopologySource } from './simulation.ts'

/** One failure scenario to run under every protocol. */
export interface ComparisonScenario {
  /** Seed, traffic, distance-vector options and queues; the protocol is overridden. */
  settings: LiveSettings
  /**
   * A custom network, in file form (a Graph cannot be posted to a worker); null runs the preset
   * in settings.topology.
   */
  network: TopologyFile | null
  /** When the link is cut, after the network has warmed up. */
  failAtMs: number
  /** How long each run continues after the cut. */
  durationMs: number
  /** The link to cut; null cuts the busiest link at failAtMs in the link-state run. */
  failLink: EdgeId | null
}

/** Warm up for 10 s, cut, then watch for 20 s: long enough for distance-vector to settle. */
export const DEFAULT_FAIL_AT_MS = 10_000
export const DEFAULT_DURATION_MS = 20_000

/** What one protocol did with the scenario. Times are measured from the cut. */
export interface ProtocolResult {
  protocol: ProtocolName
  /** Until the routers at the link noticed. */
  detectionMs: number | null
  /** Until the last forwarding table changed; null if no table had to change. */
  convergenceMs: number | null
  /** Until the protocol reported it had settled; null if it had not by the end of the run. */
  settledMs: number | null
  /** Packets dropped while converging (from the cut until settled). */
  packetsLost: number
  /** Routing messages sent while converging. */
  controlMessages: number
  /** Routing messages sent over the whole run, periodic updates included. */
  controlMessagesTotal: number
  /** Packets the traffic generator created after the cut: the same for every protocol. */
  packetsSent: number
  /** delivered / (delivered + dropped) for the packets that finished after the cut. */
  deliveryRatio: number | null
  /** Latency of the packets delivered after the cut. */
  avgLatencyMs: number | null
  p95LatencyMs: number | null
  /**
   * At the end of the run, (router, destination) pairs with a path in the network but no route
   * in the protocol: for distance-vector, destinations 16 or more hops away (RIP's infinity).
   */
  missingRoutes: number
}

export interface ComparisonOutcome {
  scenario: ComparisonScenario
  /** Such as "grid 5x5". */
  topologyName: string
  /** The link that was cut, the same in every run. */
  failedLink: EdgeId
  /** One result per protocol, link-state first. */
  results: ProtocolResult[]
}

/** What the comparison worker sends back. */
export type ComparisonReply =
  { ok: true; outcome: ComparisonOutcome } | { ok: false; error: string }

/**
 * Runs the scenario once per protocol, each from a fresh simulation with the same settings and
 * seed. The traffic generator is the only user of the random numbers, so every run sees the
 * same packets: only the routing differs. Time: that of the runs, O(events log events) each.
 * @throws Error if the link to cut does not exist, or the topology has no links.
 */
export function runComparison(scenario: ComparisonScenario): ComparisonOutcome {
  let failedLink = scenario.failLink
  let topologyName = ''
  const results = PROTOCOL_NAMES.map((protocol) => {
    const settings: LiveSettings = {
      ...scenario.settings,
      routing: { ...scenario.settings.routing, protocol },
    }
    // One latency window covering everything after the cut.
    const { sim, topology } = simulationFor(sourceOf(scenario), settings, {
      latencyWindowMs: scenario.durationMs,
    })
    topologyName = topology.name
    sim.runUntil(scenario.failAtMs)
    failedLink ??= busiestLinkNow(sim) // chosen in the first run, then kept
    if (failedLink === null) throw new Error('the topology has no links to cut')
    if (!sim.links.has(failedLink)) throw new Error(`unknown link "${failedLink}"`)

    const atCut = copyCounters(sim.stats.counters)
    sim.schedule(scenario.failAtMs, { type: 'LINK_DOWN', linkId: failedLink })
    sim.runUntil(scenario.failAtMs + scenario.durationMs)
    return measure(protocol, sim, atCut, failedLink)
  })
  return { scenario, topologyName, failedLink: failedLink as EdgeId, results }
}

/**
 * The network a scenario runs on. Time: O(V + E).
 * @throws Error if the custom network is not a valid topology file.
 */
function sourceOf(scenario: ComparisonScenario): TopologySource {
  if (scenario.network === null) return { kind: 'preset', settings: scenario.settings.topology }
  const result = readTopologyFile(scenario.network)
  if (!result.ok) throw new Error(result.errors.join(' '))
  return { kind: 'custom', topology: result.topology }
}

/** Reads one run's numbers for the cut link. Time: O(changes + window samples log samples). */
function measure(
  protocol: ProtocolName,
  sim: Simulator,
  atCut: Counters,
  failedLink: EdgeId,
): ProtocolResult {
  const record = sim.convergenceRecords().find((r) => r.linkId === failedLink && !r.up)
  if (record === undefined) throw new Error(`no record of the cut on ${failedLink}`)
  const since = (time: number | null) => (time === null ? null : time - record.changedAt)
  const now = sim.stats.counters
  const delivered = now.delivered - atCut.delivered
  const dropped = now.dropped - atCut.dropped
  const window = sim.stats.windowStats(sim.now)
  return {
    protocol,
    detectionMs: record.detectionMs,
    convergenceMs: record.convergenceMs,
    settledMs: since(record.settledAt),
    packetsLost: record.packetsLost,
    controlMessages: record.controlMessagesSent,
    controlMessagesTotal: sim.control.sent,
    packetsSent: now.generated - atCut.generated,
    deliveryRatio: delivered + dropped === 0 ? null : delivered / (delivered + dropped),
    avgLatencyMs: window.avgLatencyMs,
    p95LatencyMs: window.p95LatencyMs,
    missingRoutes: missingRoutes(sim),
  }
}

/**
 * Pairs that are connected in the real network but that the protocol has no next hop for.
 * Time: O(V (V + E)), one BFS per router.
 */
function missingRoutes(sim: Simulator): number {
  let missing = 0
  for (const router of sim.graph.nodes()) {
    for (const [destination, hops] of bfs(sim.graph, router).hops) {
      if (hops > 0 && hops < Infinity && sim.nextHop(router, destination) === undefined) missing++
    }
  }
  return missing
}

/** A table row: a label and one formatted cell per protocol. */
export interface ComparisonRow {
  label: string
  cells: string[]
  /** Index of the better result (lower is better for every row), or null on a tie. */
  best: number | null
}

const ms = (value: number | null, none: string) =>
  value === null ? none : `${Math.round(value)} ms`
const percent = (ratio: number | null) => (ratio === null ? '–' : `${(ratio * 100).toFixed(1)}%`)

/** Index of the smallest value, or null if they are all equal or any is missing. O(n). */
function lowest(values: readonly (number | null)[]): number | null {
  if (values.some((v) => v === null)) return null
  const numbers = values as number[]
  const min = Math.min(...numbers)
  const at = numbers.filter((v) => v === min)
  return at.length === numbers.length ? null : numbers.indexOf(min)
}

/** The side-by-side table: one row per metric, one cell per protocol. Time: O(protocols). */
export function comparisonRows(outcome: ComparisonOutcome): ComparisonRow[] {
  const rs = outcome.results
  const row = (
    label: string,
    format: (r: ProtocolResult) => string,
    value: ((r: ProtocolResult) => number | null) | null,
  ): ComparisonRow => ({
    label,
    cells: rs.map(format),
    best: value === null ? null : lowest(rs.map(value)),
  })
  return [
    row('Detection', (r) => ms(r.detectionMs, '–'), null),
    row(
      'Convergence',
      (r) => ms(r.convergenceMs, 'no change'),
      (r) => r.convergenceMs,
    ),
    row(
      'Settled',
      (r) => ms(r.settledMs, 'not yet'),
      (r) => r.settledMs,
    ),
    row(
      'Packets lost',
      (r) => `${r.packetsLost}`,
      (r) => r.packetsLost,
    ),
    row(
      'Routing msgs (converging)',
      (r) => `${r.controlMessages}`,
      (r) => r.controlMessages,
    ),
    row(
      'Routing msgs (whole run)',
      (r) => `${r.controlMessagesTotal}`,
      (r) => r.controlMessagesTotal,
    ),
    // Higher delivery is better, so compare the losses.
    row(
      'Delivered after cut',
      (r) => percent(r.deliveryRatio),
      (r) => (r.deliveryRatio === null ? null : 1 - r.deliveryRatio),
    ),
    row(
      'Avg latency after',
      (r) => ms(r.avgLatencyMs, '–'),
      (r) => r.avgLatencyMs,
    ),
    row(
      'p95 latency after',
      (r) => ms(r.p95LatencyMs, '–'),
      (r) => r.p95LatencyMs,
    ),
    row(
      'Missing routes at end',
      (r) => `${r.missingRoutes}`,
      (r) => r.missingRoutes,
    ),
  ]
}

/** One group of bars in the chart: a metric, its value per protocol, and each bar's length. */
export interface ChartGroup {
  label: string
  values: number[]
  /** Each value as a fraction of the group's largest value (all 0 if that is 0). */
  fractions: number[]
}

/**
 * The bar chart's data: convergence time, packets lost and routing messages while converging,
 * each scaled to its own largest value. A missing convergence time counts as 0. O(protocols).
 */
export function chartGroups(outcome: ComparisonOutcome): ChartGroup[] {
  const group = (label: string, value: (r: ProtocolResult) => number): ChartGroup => {
    const values = outcome.results.map(value)
    const max = Math.max(...values)
    return { label, values, fractions: values.map((v) => (max > 0 ? v / max : 0)) }
  }
  return [
    group('Convergence (ms)', (r) => r.convergenceMs ?? 0),
    group('Packets lost', (r) => r.packetsLost),
    group('Routing messages', (r) => r.controlMessages),
  ]
}
