// How fast the discrete-event engine runs: events processed per second of real time.
import { Simulator } from '../src/sim/Simulator.ts'
import { grid } from '../src/topology/presets.ts'
import { median } from './lib.ts'
import { round } from './dijkstra.ts'

export interface SimulatorSettings {
  /** The grid is size x size routers. */
  size: number
  /**
   * Network-wide packets per second: heavy enough that the links in the middle of the grid
   * saturate and their queues overflow (the report shows how many packets were dropped).
   */
  packetsPerSecond: number
  simMs: number
  runs: number
  seed: number
}

export const SIMULATOR_SETTINGS: SimulatorSettings = {
  size: 10,
  packetsPerSecond: 40_000,
  simMs: 60_000,
  runs: 3,
  seed: 42,
}

export interface SimulatorRow {
  [column: string]: string | number
  run: number
  routers: number
  packets_per_second: number
  sim_seconds: number
  events: number
  wall_ms: number
  events_per_second: number
  /** Simulated seconds per real second. */
  speed_vs_real_time: number
  generated: number
  delivered: number
  dropped_queue_full: number
  drop_percent: number
}

/**
 * Runs the grid with heavy traffic for simMs of simulated time, `runs` times, counting every
 * event the engine handles (packet arrivals, transmissions, traffic, stats samples, routing).
 * Each run builds a fresh simulator with the same seed, so all runs do identical work and only
 * the wall time varies. A short untimed run first lets the JIT compile the hot code.
 */
export function benchSimulator(
  settings: SimulatorSettings = SIMULATOR_SETTINGS,
  log: (line: string) => void = () => {},
): SimulatorRow[] {
  const run = (simMs: number) => {
    const sim = new Simulator(grid(settings.size, settings.size).graph, {
      seed: settings.seed,
      packetsPerSecond: settings.packetsPerSecond,
    })
    let events = 0
    const start = performance.now()
    while (sim.now < simMs && sim.step() !== undefined) events++
    return { sim, events, wallMs: performance.now() - start }
  }
  run(Math.min(2_000, settings.simMs)) // warm-up, not timed

  const rows: SimulatorRow[] = []
  for (let i = 1; i <= settings.runs; i++) {
    const { sim, events, wallMs } = run(settings.simMs)
    const counters = sim.stats.counters
    const row: SimulatorRow = {
      run: i,
      routers: settings.size * settings.size,
      packets_per_second: settings.packetsPerSecond,
      sim_seconds: settings.simMs / 1000,
      events,
      wall_ms: round(wallMs, 1),
      events_per_second: Math.round(events / (wallMs / 1000)),
      speed_vs_real_time: round(settings.simMs / wallMs, 2),
      generated: counters.generated,
      delivered: counters.delivered,
      dropped_queue_full: counters.dropsByReason['queue-full'],
      drop_percent: round((100 * counters.dropped) / counters.generated, 2),
    }
    log(
      `  run ${i}: ${events.toLocaleString('en')} events in ${row.wall_ms} ms = ` +
        `${row.events_per_second.toLocaleString('en')} events/s (${row.drop_percent}% dropped)`,
    )
    rows.push(row)
  }
  return rows
}

/** The run with the median speed. */
export function medianRun(rows: readonly SimulatorRow[]): SimulatorRow {
  const speed = median(rows.map((r) => r.events_per_second))
  return rows.reduce((best, r) =>
    Math.abs(r.events_per_second - speed) < Math.abs(best.events_per_second - speed) ? r : best,
  )
}
