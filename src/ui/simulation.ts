import type { EdgeId } from '../ds/Graph.ts'
import type { ProtocolName } from '../routing/types.ts'
import type { SimConfig } from '../sim/config.ts'
import type { ConvergenceRecord } from '../sim/convergence.ts'
import type { Packet, Priority } from '../sim/Packet.ts'
import type { QueueDiscipline } from '../sim/queues.ts'
import { Simulator } from '../sim/Simulator.ts'
import { cloneTopology, type LinkFields } from '../topology/edit.ts'
import {
  countToInfinity,
  grid,
  line,
  mapLinks,
  mesh,
  ring,
  star,
  type PresetName,
  type Topology,
} from '../topology/presets.ts'

/** The running simulation and the topology it was built from (for drawing positions). */
export interface Simulation {
  sim: Simulator
  topology: Topology
}

/** Which preset to build and how big. Only the fields for the chosen preset are used. */
export interface TopologySettings {
  preset: PresetName
  /** Routers for line, ring, star and mesh. */
  size: number
  rows: number
  cols: number
  /** Extra-link probability for mesh. */
  meshP: number
}

/**
 * Where the running network came from: a preset (rebuilt from its settings and the seed, so a
 * mesh changes with the seed) or a custom topology, built in the editor or loaded from a file.
 */
export type TopologySource =
  { kind: 'preset'; settings: TopologySettings } | { kind: 'custom'; topology: Topology }

/** Display names of the routing protocols. */
export const PROTOCOL_LABELS: Readonly<Record<ProtocolName, string>> = {
  'link-state': 'Link-State',
  'distance-vector': 'Distance-Vector',
}

/** Which routing protocol to run, and the distance-vector options. */
export interface RoutingSettings {
  protocol: ProtocolName
  splitHorizon: boolean
  poisonReverse: boolean
}

/**
 * Everything the controls can change. Topology and seed apply on Load or Reset, a protocol or
 * queue switch restarts at once, and traffic and the distance-vector options apply at once.
 */
export interface LiveSettings {
  topology: TopologySettings
  seed: number
  packetsPerSecond: number
  priorityMix: Record<Priority, number>
  routing: RoutingSettings
  /** How every link's output queues pick the next packet and what they drop when full. */
  queueDiscipline: QueueDiscipline
}

export const DEFAULT_LIVE_SETTINGS: LiveSettings = {
  topology: { preset: 'grid', size: 8, rows: 5, cols: 5, meshP: 0.04 },
  seed: 42,
  packetsPerSecond: 80,
  priorityMix: { video: 20, web: 50, bulk: 30 },
  routing: { protocol: 'link-state', splitHorizon: true, poisonReverse: false },
  queueDiscipline: 'fifo',
}

/**
 * Loading the count-to-infinity preset also switches to these settings: distance-vector with
 * both fixes off, so cutting B-C makes A and B count up to 16, and light traffic so the loop is
 * easy to follow.
 */
export const COUNT_TO_INFINITY_SETTINGS: Pick<LiveSettings, 'packetsPerSecond' | 'routing'> = {
  packetsPerSecond: 10,
  routing: { protocol: 'distance-vector', splitHorizon: false, poisonReverse: false },
}

/**
 * Count-to-infinity links: 400 ms, so each counting step (one update crossing A-B) is visible at
 * 1x, and slower than a data packet's hop is not. With TTL 8, a looping packet dies (after about
 * 3.4 s) before the count reaches 16 (about 5.6 s), as in the textbook story.
 */
export const COUNT_TO_INFINITY_DELAY_MS = 400
export const COUNT_TO_INFINITY_TTL = 8

/** Distance-vector update period in the live view. */
export const LIVE_DV_PERIOD_MS = 2_000

/** Smallest and largest size each preset accepts in the controls. */
export const SIZE_LIMITS: Readonly<Record<PresetName, { min: number; max: number }>> = {
  line: { min: 2, max: 40 },
  ring: { min: 3, max: 40 },
  star: { min: 2, max: 40 },
  grid: { min: 1, max: 12 },
  mesh: { min: 2, max: 60 },
  'count-to-infinity': { min: 3, max: 3 },
}

/**
 * Link timing for the live view. At 1x speed the simulation runs in real time, so links are
 * much slower than the preset defaults (10 Mbps, 2 ms), or packets would be invisible:
 * 200 kbps and 50x the preset delay (100 ms per grid link) make a hop take about 0.15 s.
 * Mesh links keep their distance-based delays, scaled the same way.
 */
export const LIVE_BANDWIDTH_BPS = 200_000
export const LIVE_DELAY_SCALE = 50

/** Settings for a link drawn in the editor: the same as a grid link in the live view. */
export const NEW_LINK: Readonly<LinkFields> = {
  cost: 1,
  bandwidthBps: LIVE_BANDWIDTH_BPS,
  delayMs: 2 * LIVE_DELAY_SCALE,
}

/**
 * Engine settings for the live view. Small queues and slow failure detection make a cut link
 * visible: packets pile up behind it until it is noticed 1 s later, some are dropped, and the
 * stats dip and recover once the routing protocol has spread the news.
 */
export const LIVE_SIM_CONFIG = {
  queueCapacity: 8,
  detectionDelayMs: 1_000,
  latencyWindowMs: 2_000,
  statsIntervalMs: 250,
} as const

/** The speed slider's range: simulated time per real time, 1 meaning real time. */
export const SPEED_MIN = 0.25
export const SPEED_MAX = 10
export const DEFAULT_SPEED = 1

/** Speed for a slider position t in [0, 1], on a log scale so 1x sits near the middle. O(1). */
export function speedFromSlider(t: number): number {
  return SPEED_MIN * (SPEED_MAX / SPEED_MIN) ** t
}

/** Slider position for a speed: the inverse of speedFromSlider. O(1). */
export function sliderFromSpeed(speed: number): number {
  return Math.log(speed / SPEED_MIN) / Math.log(SPEED_MAX / SPEED_MIN)
}

/** "0.25×", "1.0×", "10×". O(1). */
export function formatSpeed(speed: number): string {
  if (speed >= 9.95) return `${Math.round(speed)}×`
  return `${speed.toFixed(speed < 1 ? 2 : 1)}×`
}

/** Clamps a requested size to what the preset accepts (and to a whole number). O(1). */
export function clampSize(preset: PresetName, value: number): number {
  const { min, max } = SIZE_LIMITS[preset]
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** Builds the chosen preset with live link timing. Time: that of the preset, plus O(V + E). */
export function buildLiveTopology(settings: TopologySettings, seed: number): Topology {
  const size = clampSize(settings.preset, settings.size)
  let topology: Topology
  switch (settings.preset) {
    case 'line':
      topology = line(size)
      break
    case 'ring':
      topology = ring(size)
      break
    case 'star':
      topology = star(size)
      break
    case 'grid':
      topology = grid(clampSize('grid', settings.rows), clampSize('grid', settings.cols))
      break
    case 'mesh':
      topology = mesh(size, Math.min(1, Math.max(0, settings.meshP)), seed)
      break
    case 'count-to-infinity':
      return countToInfinity({
        bandwidthBps: LIVE_BANDWIDTH_BPS,
        delayMs: COUNT_TO_INFINITY_DELAY_MS,
      })
  }
  return mapLinks(topology, (edge) => ({
    bandwidthBps: LIVE_BANDWIDTH_BPS,
    delayMs: Math.round(edge.delayMs * LIVE_DELAY_SCALE),
  }))
}

/**
 * Builds a fresh simulation from the settings, with traffic running, on `topology` if given
 * (it is used as it is, not copied) or else on the preset the settings name. `engine`
 * overrides any engine setting (the comparison uses it to measure latency over a longer window).
 * Time: O(V (V + E) log V) for the routing tables.
 * @throws RangeError if the traffic settings are invalid (for example, every weight is 0).
 */
export function createSimulation(
  settings: LiveSettings = DEFAULT_LIVE_SETTINGS,
  engine: Partial<SimConfig> = {},
  custom?: Topology,
): Simulation {
  const topology = custom ?? buildLiveTopology(settings.topology, settings.seed)
  // The count-to-infinity preset brings a short TTL; a custom network keeps the default.
  const countToInfinity = custom === undefined && settings.topology.preset === 'count-to-infinity'
  const sim = new Simulator(topology.graph, {
    ...LIVE_SIM_CONFIG,
    seed: settings.seed,
    packetsPerSecond: settings.packetsPerSecond,
    priorityMix: settings.priorityMix,
    routing: settings.routing.protocol,
    splitHorizon: settings.routing.splitHorizon,
    poisonReverse: settings.routing.poisonReverse,
    dvPeriodMs: LIVE_DV_PERIOD_MS,
    queueDiscipline: settings.queueDiscipline,
    ...(countToInfinity && { defaultTtl: COUNT_TO_INFINITY_TTL }),
    ...engine,
  })
  return { sim, topology }
}

/**
 * A simulation of `source` with the settings: a preset is rebuilt from its own settings, and a
 * custom topology is copied, since the simulator marks links down in the graph it is given.
 * Time: as createSimulation.
 */
export function simulationFor(
  source: TopologySource,
  settings: LiveSettings,
  engine: Partial<SimConfig> = {},
): Simulation {
  if (source.kind === 'preset')
    return createSimulation({ ...settings, topology: source.settings }, engine)
  return createSimulation(settings, engine, cloneTopology(source.topology))
}

/**
 * Cuts the link if it is up, restores it if it is down, by scheduling LINK_DOWN or LINK_UP at
 * the current simulated time. It is applied at once, even while paused; detection and route
 * recomputation follow as usual. Time: O(P) for P packets on links (a cut drops those on it).
 */
export function toggleLink(simulation: Simulation, linkId: EdgeId): void {
  const { sim } = simulation
  const link = sim.links.get(linkId)
  if (link === undefined) return
  sim.schedule(sim.now, { type: link.up ? 'LINK_DOWN' : 'LINK_UP', linkId })
  sim.runUntil(sim.now)
}

/** Toast text for a link change once the network has settled, with what it cost. O(1). */
export function describeChange(record: ConvergenceRecord): string {
  const state = record.up ? 'up' : 'down'
  const cost =
    `${plural(record.packetsLost, 'packet')} lost, ` +
    `${plural(record.controlMessagesSent, 'routing message')}`
  if (record.convergenceMs === null) {
    return `Link ${record.linkId} ${state}: no routes needed to change (${cost})`
  }
  return `Link ${record.linkId} ${state}, converged in ${record.convergenceMs} ms (${cost})`
}

/** "1 packet", "3 packets". O(1). */
export function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * Toast text for a manually sent packet once it has finished, or null while it is travelling.
 * Time: O(1).
 */
export function describePacket(packet: Packet): string | null {
  const route = `Packet ${packet.src} → ${packet.dst}`
  if (packet.status === 'delivered') {
    const ms = Math.round((packet.finishedAt as number) - packet.createdAt)
    return `${route} delivered in ${ms} ms over ${packet.hops.length - 1} hops`
  }
  if (packet.status === 'dropped') {
    return `${route} dropped at ${packet.hops[packet.hops.length - 1]} (${packet.dropReason})`
  }
  return null
}
