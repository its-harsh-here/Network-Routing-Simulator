import { PROTOCOL_NAMES, type ProtocolName } from '../routing/types.ts'
import type { EdgeId } from '../ds/Graph.ts'
import { PRIORITIES, type Priority } from './Packet.ts'
import { QUEUE_DISCIPLINES, type QueueDiscipline } from './queues.ts'

/** Simulation settings. Times are in simulated milliseconds. */
export interface SimConfig {
  /** Seed for the Rng: the same seed and topology give exactly the same run. */
  seed: number
  /** Packets each output queue can hold, not counting the one being transmitted. */
  queueCapacity: number
  /** How every output queue orders and drops packets, unless linkQueueDiscipline says otherwise. */
  queueDiscipline: QueueDiscipline
  /** Per-link exceptions to queueDiscipline, by link id (both directions of the link). */
  linkQueueDiscipline: Record<EdgeId, QueueDiscipline>
  /** TTL of new packets: how many links a packet may cross before it is dropped. */
  defaultTtl: number
  /** Average packets created per simulated second across the whole network. 0 turns traffic off. */
  packetsPerSecond: number
  /** Relative weights for choosing each generated packet's priority. */
  priorityMix: Record<Priority, number>
  /** Packet size in bytes for each priority. */
  packetSizeBytes: Record<Priority, number>
  /** How long the two routers next to a link take to notice it went down or up. */
  detectionDelayMs: number
  /** Which routing protocol the routers run. */
  routing: ProtocolName
  /** Distance-vector: time between each router's periodic updates. */
  dvPeriodMs: number
  /** Distance-vector: do not advertise routes back to the neighbour they were learned from. */
  splitHorizon: boolean
  /** Distance-vector: advertise routes back to the neighbour they were learned from as unreachable. */
  poisonReverse: boolean
  /** Time between STATS_SAMPLE events. 0 turns sampling off. */
  statsIntervalMs: number
  /** How many samples each time series keeps. When full, the oldest is overwritten. */
  maxSamples: number
  /** Length of the sliding window for latency and throughput figures. */
  latencyWindowMs: number
}

export const DEFAULT_CONFIG: Readonly<SimConfig> = {
  seed: 1,
  queueCapacity: 32,
  queueDiscipline: 'fifo',
  linkQueueDiscipline: {},
  defaultTtl: 32,
  packetsPerSecond: 100,
  priorityMix: { video: 0.2, web: 0.5, bulk: 0.3 },
  packetSizeBytes: { video: 1200, web: 600, bulk: 1500 },
  detectionDelayMs: 100,
  routing: 'link-state',
  dvPeriodMs: 1_000,
  splitHorizon: true,
  poisonReverse: false,
  statsIntervalMs: 250,
  maxSamples: 300,
  latencyWindowMs: 5_000,
}

/**
 * Fills in DEFAULT_CONFIG for anything left out and checks every value.
 * Time: O(1).
 * @throws RangeError naming the first invalid setting.
 */
export function resolveConfig(overrides: Partial<SimConfig> = {}): SimConfig {
  const config: SimConfig = { ...DEFAULT_CONFIG, ...overrides }
  const check = (ok: boolean, message: string) => {
    if (!ok) throw new RangeError(`SimConfig: ${message}`)
  }
  const isCount = (value: number, min: number) => Number.isInteger(value) && value >= min
  const isTime = (value: number) => Number.isFinite(value) && value >= 0

  check(isCount(config.queueCapacity, 1), 'queueCapacity must be an integer >= 1')
  check(isCount(config.defaultTtl, 0), 'defaultTtl must be an integer >= 0')
  check(isTime(config.packetsPerSecond), 'packetsPerSecond must be >= 0')
  check(isTime(config.detectionDelayMs), 'detectionDelayMs must be >= 0')
  const isDiscipline = (value: string) => (QUEUE_DISCIPLINES as readonly string[]).includes(value)
  check(isDiscipline(config.queueDiscipline), 'queueDiscipline must be fifo or priority')
  for (const [link, discipline] of Object.entries(config.linkQueueDiscipline)) {
    check(isDiscipline(discipline), `linkQueueDiscipline.${link} must be fifo or priority`)
  }
  check(PROTOCOL_NAMES.includes(config.routing), 'routing must be link-state or distance-vector')
  check(isTime(config.dvPeriodMs) && config.dvPeriodMs > 0, 'dvPeriodMs must be > 0')
  check(typeof config.splitHorizon === 'boolean', 'splitHorizon must be true or false')
  check(typeof config.poisonReverse === 'boolean', 'poisonReverse must be true or false')
  check(isTime(config.statsIntervalMs), 'statsIntervalMs must be >= 0')
  check(isCount(config.maxSamples, 1), 'maxSamples must be an integer >= 1')
  check(isTime(config.latencyWindowMs) && config.latencyWindowMs > 0, 'latencyWindowMs must be > 0')

  let totalWeight = 0
  for (const priority of PRIORITIES) {
    const weight = config.priorityMix[priority]
    const size = config.packetSizeBytes[priority]
    check(Number.isFinite(weight) && weight >= 0, `priorityMix.${priority} must be >= 0`)
    check(Number.isFinite(size) && size > 0, `packetSizeBytes.${priority} must be > 0`)
    totalWeight += weight
  }
  check(totalWeight > 0, 'priorityMix needs at least one positive weight')
  return config
}
