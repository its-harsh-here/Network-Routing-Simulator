// Headless runner: builds a preset topology, runs Poisson traffic, optionally cuts a link, and
// reports stats before and after. Pure functions, so tests can call them; scripts/sim.ts does the
// command-line input and output.
import type { EdgeId, NodeId } from '../ds/Graph.ts'
import { PROTOCOL_NAMES, type ProtocolName } from '../routing/types.ts'
import {
  countToInfinity,
  grid,
  line,
  mesh,
  PRESET_NAMES,
  ring,
  star,
  type PresetName,
  type Topology,
} from '../topology/presets.ts'
import type { ConvergenceRecord } from './convergence.ts'
import { DROP_REASONS, type DropReason } from './Packet.ts'
import { Simulator } from './Simulator.ts'
import { copyCounters, createCounters, type Counters, type TimePoint } from './stats.ts'

export interface RunnerOptions {
  preset: PresetName
  /** Number of routers; for grid, the side length. */
  size: number
  seconds: number
  seed: number
  packetsPerSecond: number
  /** Second at which a link goes down, or null for no failure. */
  failAt: number | null
  /** The link to cut. null picks the busiest link at failAt. */
  failLink: EdgeId | null
  /** Extra-link probability for the mesh preset. */
  meshP: number
  protocol: ProtocolName
  /** Distance-vector only. */
  splitHorizon: boolean
  /** Distance-vector only. */
  poisonReverse: boolean
  help: boolean
}

export const DEFAULT_RUNNER_OPTIONS: Readonly<RunnerOptions> = {
  preset: 'grid',
  size: 5,
  seconds: 30,
  seed: 42,
  packetsPerSecond: 2_000,
  failAt: null,
  failLink: null,
  meshP: 0.1,
  protocol: 'link-state',
  splitHorizon: true,
  poisonReverse: false,
  help: false,
}

export const USAGE = `Usage: npm run sim -- [options]
  --preset <name>    line, ring, star, grid or mesh        (default grid)
  --size <n>         number of routers; grid is n x n       (default 5)
  --seconds <s>      simulated seconds                      (default 30)
  --seed <n>         random seed                            (default 42)
  --rate <pps>       packets per second, network-wide       (default 2000)
  --fail-at <s>      cut a link at this second              (default: no failure)
  --fail-link <id>   the link to cut, e.g. R12-R13          (default: the busiest)
  --p <0..1>         extra-link probability for mesh        (default 0.1)
  --protocol <name>  link-state or distance-vector          (default link-state)
  --split-horizon <on|off>   distance-vector option         (default on)
  --poison-reverse <on|off>  distance-vector option         (default off)
  --help             show this help`

/** Stats for one period of the run. */
export interface PeriodSummary {
  label: string
  fromMs: number
  toMs: number
  generated: number
  delivered: number
  dropped: number
  dropsByReason: Record<DropReason, number>
  /** delivered / (delivered + dropped) for packets that finished in the period. */
  deliveryRatio: number | null
  /** Delivered packets per second over the period. */
  throughputPps: number
  /** Mean latency of the packets delivered in the period. */
  avgLatencyMs: number | null
  /** p95 latency of the 5-second window ending at the end of the period. */
  p95LatencyMs: number | null
  /** Highest 5-second-window p95 seen at any sample in the period. */
  worstP95LatencyMs: number | null
  peakQueue: { router: NodeId; packets: number } | null
  busiestLink: { link: EdgeId; utilisation: number } | null
}

export interface RunReport {
  options: RunnerOptions
  topologyName: string
  routerCount: number
  linkCount: number
  failedLink: EdgeId | null
  /** Utilisation of the failed link in the last sample before it failed. */
  failedLinkUtilisation: number | null
  periods: PeriodSummary[]
  convergence: ConvergenceRecord | null
  totals: Counters
}

/**
 * Reads command-line arguments such as ["--preset", "grid", "--size", "5"].
 * Time: O(number of arguments).
 * @throws Error naming the bad argument.
 */
export function parseRunnerArgs(argv: readonly string[]): RunnerOptions {
  const options: RunnerOptions = { ...DEFAULT_RUNNER_OPTIONS }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--help' || flag === '-h') {
      options.help = true
      continue
    }
    const value = argv[++i]
    if (value === undefined) throw new Error(`${flag} needs a value`)
    switch (flag) {
      case '--preset':
        if (!isPresetName(value)) throw new Error(`unknown preset "${value}"`)
        options.preset = value
        break
      case '--size':
        options.size = parseNumber(flag, value, 1, true)
        break
      case '--seconds':
        options.seconds = parseNumber(flag, value, 0.001, false)
        break
      case '--seed':
        options.seed = parseNumber(flag, value, -(2 ** 31), true)
        break
      case '--rate':
        options.packetsPerSecond = parseNumber(flag, value, 0, false)
        break
      case '--fail-at':
        options.failAt = parseNumber(flag, value, 0, false)
        break
      case '--fail-link':
        options.failLink = value
        break
      case '--protocol':
        if (!(PROTOCOL_NAMES as readonly string[]).includes(value)) {
          throw new Error(`unknown protocol "${value}"`)
        }
        options.protocol = value as ProtocolName
        break
      case '--split-horizon':
        options.splitHorizon = parseSwitch(flag, value)
        break
      case '--poison-reverse':
        options.poisonReverse = parseSwitch(flag, value)
        break
      case '--p':
        options.meshP = parseNumber(flag, value, 0, false)
        if (options.meshP > 1) throw new Error('--p must be between 0 and 1')
        break
      default:
        throw new Error(`unknown option ${flag}`)
    }
  }
  if (options.failAt !== null && options.failAt >= options.seconds) {
    throw new Error(
      `--fail-at (${options.failAt}) must be less than --seconds (${options.seconds})`,
    )
  }
  return options
}

/** Builds the preset named in `options`. Time: that of the preset. */
export function buildTopology(options: RunnerOptions): Topology {
  switch (options.preset) {
    case 'line':
      return line(options.size)
    case 'ring':
      return ring(options.size)
    case 'star':
      return star(options.size)
    case 'grid':
      return grid(options.size, options.size)
    case 'mesh':
      return mesh(options.size, options.meshP, options.seed)
    case 'count-to-infinity':
      return countToInfinity()
  }
}

/**
 * Runs the scenario: traffic from time 0, the link failure at failAt (if any), until `seconds`.
 * Time: dominated by the simulation, O(k log n) for k events.
 * @throws Error if --fail-link names a link that does not exist.
 */
export function runScenario(options: RunnerOptions): RunReport {
  const topology = buildTopology(options)
  const sim = new Simulator(topology.graph, {
    seed: options.seed,
    packetsPerSecond: options.packetsPerSecond,
    routing: options.protocol,
    splitHorizon: options.splitHorizon,
    poisonReverse: options.poisonReverse,
  })
  const endMs = options.seconds * 1000
  const report: RunReport = {
    options,
    topologyName: topology.name,
    routerCount: topology.graph.nodeCount,
    linkCount: topology.graph.edgeCount,
    failedLink: null,
    failedLinkUtilisation: null,
    periods: [],
    convergence: null,
    totals: createCounters(),
  }

  if (options.failAt === null) {
    sim.runUntil(endMs)
    report.periods.push(summarize('whole run', sim, createCounters(), 0, endMs))
  } else {
    const failMs = options.failAt * 1000
    sim.runUntil(failMs)
    report.periods.push(summarize('before', sim, createCounters(), 0, failMs))
    const atFailure = copyCounters(sim.stats.counters)

    const utilisation = linkUtilisationNow(sim)
    const failedLink = options.failLink ?? busiestLinkNow(sim)
    if (failedLink === null) throw new Error('the topology has no links to cut')
    if (!utilisation.has(failedLink)) throw new Error(`unknown link "${failedLink}"`)
    report.failedLink = failedLink
    report.failedLinkUtilisation = utilisation.get(failedLink) as number

    sim.schedule(failMs, { type: 'LINK_DOWN', linkId: failedLink })
    sim.runUntil(endMs)
    report.periods.push(summarize('after', sim, atFailure, failMs, endMs))
    report.convergence = sim.convergenceRecords().find((r) => r.linkId === failedLink) ?? null
  }
  report.totals = copyCounters(sim.stats.counters)
  return report
}

/** Turns a report into the text the runner prints. Time: O(periods). */
export function formatReport(report: RunReport): string {
  const { options, periods } = report
  const lines = [
    'Network Routing Simulator: headless run',
    `  topology   ${report.topologyName}: ${report.routerCount} routers, ${report.linkCount} links`,
    `  traffic    ${options.packetsPerSecond} packets/s for ${options.seconds} s, seed ${options.seed}`,
    `  routing    ${describeRouting(options)}`,
  ]
  if (report.failedLink !== null) {
    const chosen = options.failLink === null ? 'the busiest link at that moment, ' : ''
    const used = percent(report.failedLinkUtilisation)
    lines.push(
      `  failure    ${report.failedLink} goes down at ${options.failAt} s (${chosen}${used} utilised)`,
    )
  }
  lines.push('')

  const header = periods.map((p) => `${p.label} (${p.fromMs / 1000}-${p.toMs / 1000} s)`)
  const table: [string, string[]][] = [
    ['', header],
    ['packets generated', periods.map((p) => `${p.generated}`)],
    ['delivered', periods.map((p) => `${p.delivered} (${percent(p.deliveryRatio, 1)})`)],
    ['dropped', periods.map((p) => `${p.dropped}`)],
    ...DROP_REASONS.map((reason): [string, string[]] => [
      `  ${reason}`,
      periods.map((p) => `${p.dropsByReason[reason]}`),
    ]),
    ['throughput (packets/s)', periods.map((p) => p.throughputPps.toFixed(1))],
    ['average latency (ms)', periods.map((p) => fixed(p.avgLatencyMs))],
    ['p95 latency, last 5 s (ms)', periods.map((p) => fixed(p.p95LatencyMs))],
    ['worst 5-s p95 latency (ms)', periods.map((p) => fixed(p.worstP95LatencyMs))],
    [
      'peak router queue',
      periods.map((p) =>
        p.peakQueue ? `${p.peakQueue.router}: ${p.peakQueue.packets} pkts` : '-',
      ),
    ],
    [
      'busiest link',
      periods.map((p) =>
        p.busiestLink ? `${p.busiestLink.link}: ${percent(p.busiestLink.utilisation)}` : '-',
      ),
    ],
  ]
  const labelWidth = Math.max(...table.map(([label]) => label.length))
  const columnWidth = Math.max(...table.flatMap(([, values]) => values.map((v) => v.length)))
  for (const [label, values] of table) {
    lines.push(
      `  ${label.padEnd(labelWidth)}  ${values.map((v) => v.padStart(columnWidth)).join('  ')}`,
    )
  }

  const record = report.convergence
  if (record !== null) {
    lines.push('')
    const after = (time: number | null) =>
      time === null ? 'never' : `${time - record.changedAt} ms`
    lines.push(
      `  convergence  detected after ${after(record.detectedAt)}, settled after ` +
        `${after(record.settledAt)}; ${record.tablesChanged} route changes ` +
        `across ${report.routerCount} routers`,
    )
    lines.push(
      `               convergence time (last table change - failure): ` +
        (record.convergenceMs === null
          ? 'no table needed to change'
          : `${record.convergenceMs} ms`),
    )
    lines.push(
      `               while converging: ${record.packetsLost} packets lost, ` +
        `${record.controlMessagesSent} routing messages sent`,
    )
  }
  return lines.join('\n')
}

/** "link-state", or "distance-vector (split horizon on, poison reverse off)". */
function describeRouting(options: RunnerOptions): string {
  if (options.protocol === 'link-state') return 'link-state'
  const state = (on: boolean) => (on ? 'on' : 'off')
  return (
    `distance-vector (split horizon ${state(options.splitHorizon)}, ` +
    `poison reverse ${state(options.poisonReverse)})`
  )
}

function parseSwitch(flag: string, text: string): boolean {
  if (text === 'on') return true
  if (text === 'off') return false
  throw new Error(`${flag} must be on or off, got "${text}"`)
}

function isPresetName(value: string): value is PresetName {
  return (PRESET_NAMES as readonly string[]).includes(value)
}

function parseNumber(flag: string, text: string, min: number, integer: boolean): number {
  const value = Number(text)
  if (!Number.isFinite(value) || value < min || (integer && !Number.isInteger(value))) {
    const kind = integer ? 'an integer' : 'a number'
    throw new Error(`${flag} must be ${kind} >= ${min}, got "${text}"`)
  }
  return value
}

/** Stats for the period fromMs..toMs, as the change in counters since `start`. */
function summarize(
  label: string,
  sim: Simulator,
  start: Counters,
  fromMs: number,
  toMs: number,
): PeriodSummary {
  const end = sim.stats.counters
  const delivered = end.delivered - start.delivered
  const dropped = end.dropped - start.dropped
  const dropsByReason = createCounters().dropsByReason
  for (const reason of DROP_REASONS) {
    dropsByReason[reason] = end.dropsByReason[reason] - start.dropsByReason[reason]
  }
  const inPeriod = (point: { time: number }) => point.time > fromMs && point.time <= toMs
  const p95s = [...sim.stats.network]
    .filter(inPeriod)
    .map((sample) => sample.p95LatencyMs)
    .filter((p95): p95 is number => p95 !== null)

  return {
    label,
    fromMs,
    toMs,
    generated: end.generated - start.generated,
    delivered,
    dropped,
    dropsByReason,
    deliveryRatio: delivered + dropped > 0 ? delivered / (delivered + dropped) : null,
    throughputPps: delivered / ((toMs - fromMs) / 1000),
    avgLatencyMs: delivered > 0 ? (end.totalLatencyMs - start.totalLatencyMs) / delivered : null,
    p95LatencyMs: sim.stats.windowStats(toMs).p95LatencyMs,
    worstP95LatencyMs: p95s.length > 0 ? Math.max(...p95s) : null,
    peakQueue: peakOf(sim.stats.routerQueues, inPeriod, (router, packets) => ({ router, packets })),
    busiestLink: peakOf(sim.stats.linkUtilisation, inPeriod, (link, utilisation) => ({
      link,
      utilisation,
    })),
  }
}

/** The largest value in any of the series within the period, labelled with its series key. */
function peakOf<K, R>(
  series: Map<K, Iterable<TimePoint>>,
  inPeriod: (point: TimePoint) => boolean,
  label: (key: K, value: number) => R,
): R | null {
  let bestKey: K | undefined
  let bestValue = -Infinity
  for (const [key, points] of series) {
    for (const point of points) {
      if (inPeriod(point) && point.value > bestValue) {
        bestKey = key
        bestValue = point.value
      }
    }
  }
  return bestKey === undefined ? null : label(bestKey, bestValue)
}

/** Each link's utilisation in the last stats window: the busier of its two directions. */
function linkUtilisationNow(sim: Simulator): Map<EdgeId, number> {
  return new Map(
    sim
      .snapshot()
      .links.map((link) => [link.id, Math.max(link.aToB.utilisation, link.bToA.utilisation)]),
  )
}

/**
 * The link with the highest utilisation in the last stats window (the first one on ties), or
 * null if there are no links. Time: O(V + E).
 */
export function busiestLinkNow(sim: Simulator): EdgeId | null {
  let best: EdgeId | null = null
  let bestValue = -Infinity
  for (const [link, value] of linkUtilisationNow(sim)) {
    if (value > bestValue) {
      best = link
      bestValue = value
    }
  }
  return best
}

function percent(value: number | null, digits = 0): string {
  return value === null ? '-' : `${(value * 100).toFixed(digits)}%`
}

function fixed(value: number | null): string {
  return value === null ? '-' : value.toFixed(2)
}
