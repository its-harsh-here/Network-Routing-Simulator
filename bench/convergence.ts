// Protocol convergence: the same link failures under link-state and distance-vector (with and
// without split horizon), on a ring, a grid and a random mesh.
import { bfs } from '../src/algo/bfs.ts'
import { findBridgesAndArticulationPoints } from '../src/algo/tarjan.ts'
import type { EdgeId } from '../src/ds/Graph.ts'
import type { ProtocolName } from '../src/routing/types.ts'
import { Rng } from '../src/sim/rng.ts'
import { Simulator } from '../src/sim/Simulator.ts'
import { grid, mesh, ring, type Topology } from '../src/topology/presets.ts'
import { round } from './dijkstra.ts'

export interface Setup {
  label: string
  protocol: ProtocolName
  splitHorizon: boolean
}

export const SETUPS: readonly Setup[] = [
  { label: 'link-state', protocol: 'link-state', splitHorizon: true },
  { label: 'DV + split horizon', protocol: 'distance-vector', splitHorizon: true },
  { label: 'DV, no split horizon', protocol: 'distance-vector', splitHorizon: false },
]

export interface ConvergenceSettings {
  seed: number
  failures: number
  packetsPerSecond: number
  /** Time to settle before the cut (distance-vector starts knowing only its neighbours). */
  warmupMs: number
  /** Time watched after the cut. */
  watchMs: number
}

export const CONVERGENCE_SETTINGS: ConvergenceSettings = {
  seed: 7,
  failures: 10,
  packetsPerSecond: 1_000,
  warmupMs: 5_000,
  watchMs: 30_000,
}

/** The three networks, with preset links (10 Mbps, 2 ms; the mesh's delays follow distance). */
export function convergenceTopologies(seed: number): { name: string; topology: Topology }[] {
  return [
    { name: 'ring(20)', topology: ring(20) },
    { name: 'grid(6x6)', topology: grid(6, 6) },
    { name: 'mesh(40)', topology: mesh(40, 0.1, seed) },
  ]
}

/**
 * `count` links chosen at random (seeded) among those that are not bridges, so every cut leaves
 * the network connected. Fewer if there are not that many. Time: O(V + E) for Tarjan, plus the
 * shuffle.
 */
export function pickNonBridgeLinks(topology: Topology, count: number, rng: Rng): EdgeId[] {
  const bridges = new Set(findBridgesAndArticulationPoints(topology.graph).bridges.map((e) => e.id))
  const candidates = topology.graph
    .edges()
    .map((e) => e.id)
    .filter((id) => !bridges.has(id))
  // Fisher-Yates shuffle, then take the first `count`.
  for (let i = candidates.length - 1; i > 0; i--) {
    const j = rng.randomInt(0, i)
    ;[candidates[i], candidates[j]] = [candidates[j], candidates[i]]
  }
  return candidates.slice(0, count)
}

export interface FailureRow {
  [column: string]: string | number
  topology: string
  setup: string
  link: EdgeId
  /** '' if no forwarding table had to change. */
  convergence_ms: number | ''
  /** '' if the protocol had not settled by the end of the watch. */
  settled_ms: number | ''
  packets_lost: number
  control_messages: number
  /** Router pairs still connected but with no route at the end (distance-vector's 16-hop limit). */
  missing_routes: number
}

export interface SummaryRow {
  [column: string]: string | number
  topology: string
  setup: string
  failures: number
  avg_convergence_ms: number
  avg_settled_ms: number | ''
  not_settled: number
  avg_packets_lost: number
  avg_control_messages: number
  avg_missing_routes: number
}

/**
 * Cuts each chosen link in a fresh simulation (same seed, so the same traffic) under each setup,
 * and records what the convergence record says: time to the last route change, time until the
 * protocol settled, packets lost and routing messages sent while converging.
 */
export function benchConvergence(
  settings: ConvergenceSettings = CONVERGENCE_SETTINGS,
  log: (line: string) => void = () => {},
): { failures: FailureRow[]; summary: SummaryRow[] } {
  const failures: FailureRow[] = []
  const summary: SummaryRow[] = []
  for (const { name, topology } of convergenceTopologies(settings.seed)) {
    const links = pickNonBridgeLinks(topology, settings.failures, new Rng(settings.seed))
    for (const setup of SETUPS) {
      const rows = links.map((link) => cutOnce(name, topology, link, setup, settings))
      failures.push(...rows)
      const changed = rows.filter((r) => r.convergence_ms !== '')
      const settled = rows.filter((r) => r.settled_ms !== '')
      const mean = (values: number[]) =>
        values.length === 0 ? 0 : round(values.reduce((a, b) => a + b, 0) / values.length, 1)
      const row: SummaryRow = {
        topology: name,
        setup: setup.label,
        failures: rows.length,
        avg_convergence_ms: mean(changed.map((r) => r.convergence_ms as number)),
        avg_settled_ms:
          settled.length === 0 ? '' : mean(settled.map((r) => r.settled_ms as number)),
        not_settled: rows.length - settled.length,
        avg_packets_lost: mean(rows.map((r) => r.packets_lost)),
        avg_control_messages: mean(rows.map((r) => r.control_messages)),
        avg_missing_routes: mean(rows.map((r) => r.missing_routes)),
      }
      log(
        `  ${name.padEnd(10)} ${setup.label.padEnd(21)} convergence ${String(row.avg_convergence_ms).padStart(7)} ms` +
          `  lost ${String(row.avg_packets_lost).padStart(6)}  messages ${String(row.avg_control_messages).padStart(7)}` +
          (row.not_settled > 0 ? `  (${row.not_settled} not settled)` : ''),
      )
      summary.push(row)
    }
  }
  return { failures, summary }
}

function cutOnce(
  name: string,
  topology: Topology,
  link: EdgeId,
  setup: Setup,
  settings: ConvergenceSettings,
): FailureRow {
  const sim = new Simulator(topology.graph, {
    seed: settings.seed,
    packetsPerSecond: settings.packetsPerSecond,
    routing: setup.protocol,
    splitHorizon: setup.splitHorizon,
    poisonReverse: false,
  })
  sim.runUntil(settings.warmupMs)
  sim.schedule(settings.warmupMs, { type: 'LINK_DOWN', linkId: link })
  sim.runUntil(settings.warmupMs + settings.watchMs)
  const record = sim.convergenceRecords().find((r) => r.linkId === link)
  if (record === undefined) throw new Error(`no record of the cut on ${link}`)
  let missing = 0
  for (const router of sim.graph.nodes()) {
    for (const [destination, hops] of bfs(sim.graph, router).hops) {
      if (hops > 0 && hops < Infinity && sim.nextHop(router, destination) === undefined) missing++
    }
  }
  return {
    topology: name,
    setup: setup.label,
    link,
    convergence_ms: record.convergenceMs ?? '',
    settled_ms: record.settledAt === null ? '' : round(record.settledAt - record.changedAt, 1),
    packets_lost: record.packetsLost,
    control_messages: record.controlMessagesSent,
    missing_routes: missing,
  }
}
