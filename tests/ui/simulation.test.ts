import { describe, expect, it } from 'vitest'
import { createConvergenceRecord } from '../../src/sim/convergence.ts'
import type { Packet } from '../../src/sim/Packet.ts'
import { PRESET_NAMES } from '../../src/topology/presets.ts'
import {
  buildLiveTopology,
  clampSize,
  COUNT_TO_INFINITY_DELAY_MS,
  COUNT_TO_INFINITY_SETTINGS,
  COUNT_TO_INFINITY_TTL,
  createSimulation,
  DEFAULT_LIVE_SETTINGS,
  describeChange,
  describePacket,
  formatSpeed,
  LIVE_BANDWIDTH_BPS,
  LIVE_SIM_CONFIG,
  simulationFor,
  SIZE_LIMITS,
  sliderFromSpeed,
  SPEED_MAX,
  SPEED_MIN,
  speedFromSlider,
  type TopologySettings,
} from '../../src/ui/simulation.ts'
import { isValidMix } from '../../src/ui/useLiveSimulation.ts'

describe('speed slider', () => {
  it('runs from 0.25x to 10x on a log scale', () => {
    expect(speedFromSlider(0)).toBeCloseTo(SPEED_MIN, 12)
    expect(speedFromSlider(1)).toBeCloseTo(SPEED_MAX, 12)
    // On a log scale the middle is the geometric mean: sqrt(0.25 * 10) ~ 1.58.
    expect(speedFromSlider(0.5)).toBeCloseTo(Math.sqrt(SPEED_MIN * SPEED_MAX), 12)
  })

  it('converts back and forth', () => {
    for (const speed of [0.25, 0.5, 1, 2, 7.5, 10]) {
      expect(speedFromSlider(sliderFromSpeed(speed))).toBeCloseTo(speed, 9)
    }
  })

  it('formats speeds compactly', () => {
    expect(formatSpeed(0.25)).toBe('0.25×')
    expect(formatSpeed(1)).toBe('1.0×')
    expect(formatSpeed(3.456)).toBe('3.5×')
    expect(formatSpeed(10)).toBe('10×')
  })
})

describe('live topology', () => {
  const settings: TopologySettings = { preset: 'grid', size: 8, rows: 3, cols: 4, meshP: 0.1 }

  it('builds every preset with the slow live link timing', () => {
    for (const preset of PRESET_NAMES) {
      const topology = buildLiveTopology({ ...settings, preset }, 7)
      expect(topology.graph.nodeCount).toBeGreaterThan(1)
      expect(topology.graph.edges().every((e) => e.bandwidthBps === LIVE_BANDWIDTH_BPS)).toBe(true)
    }
    // Grid links are 2 ms in the preset, so 100 ms here.
    const gridLinks = buildLiveTopology(settings, 7).graph.edges()
    expect(gridLinks.every((e) => e.delayMs === 100)).toBe(true)
    expect(gridLinks.length).toBe(3 * 3 + 4 * 2)
  })

  it('clamps sizes to what each preset accepts', () => {
    expect(clampSize('ring', 1)).toBe(SIZE_LIMITS.ring.min)
    expect(clampSize('grid', 99)).toBe(SIZE_LIMITS.grid.max)
    expect(clampSize('line', 6.6)).toBe(7)
    expect(clampSize('mesh', NaN)).toBe(SIZE_LIMITS.mesh.min)
    expect(buildLiveTopology({ ...settings, preset: 'ring', size: 0 }, 1).graph.nodeCount).toBe(3)
  })

  it('creates a simulation with the live engine settings and the chosen traffic', () => {
    const { sim, topology } = createSimulation({
      ...DEFAULT_LIVE_SETTINGS,
      seed: 5,
      packetsPerSecond: 33,
      priorityMix: { video: 1, web: 0, bulk: 0 },
    })
    expect(topology.name).toBe('grid 5x5')
    expect(sim.config).toMatchObject({ ...LIVE_SIM_CONFIG, seed: 5, packetsPerSecond: 33 })
    sim.runUntil(3_000)
    expect(sim.stats.counters.generated).toBeGreaterThan(50)
  })

  it('rejects traffic settings with no positive weight', () => {
    const noWeights = { ...DEFAULT_LIVE_SETTINGS, priorityMix: { video: 0, web: 0, bulk: 0 } }
    expect(isValidMix(noWeights.priorityMix)).toBe(false)
    expect(isValidMix(DEFAULT_LIVE_SETTINGS.priorityMix)).toBe(true)
    expect(() => createSimulation(noWeights)).toThrow(RangeError)
  })
})

describe('simulationFor', () => {
  it('builds presets from their settings and copies custom networks', () => {
    const preset = simulationFor(
      { kind: 'preset', settings: { ...DEFAULT_LIVE_SETTINGS.topology, rows: 2, cols: 3 } },
      DEFAULT_LIVE_SETTINGS,
    )
    expect(preset.topology.name).toBe('grid 2x3')

    const custom = buildLiveTopology({ preset: 'ring', size: 4, rows: 1, cols: 1, meshP: 0 }, 1)
    const { sim, topology } = simulationFor(
      { kind: 'custom', topology: custom },
      DEFAULT_LIVE_SETTINGS,
    )
    expect(topology).not.toBe(custom)
    sim.schedule(0, { type: 'LINK_DOWN', linkId: 'R0-R1' })
    sim.runUntil(0)
    expect(sim.graph.getEdge('R0-R1')?.up).toBe(false)
    expect(custom.graph.getEdge('R0-R1')?.up).toBe(true) // the design is untouched
    expect(sim.config.defaultTtl).toBe(32) // only the count-to-infinity preset shortens TTL
  })
})

describe('toast text', () => {
  it('describes a finished link change', () => {
    const record = createConvergenceRecord(0, 'R4-R9', false, 1_000)
    record.settledAt = 4_000
    record.convergenceMs = 3_000
    record.packetsLost = 7
    record.controlMessagesSent = 1
    expect(describeChange(record)).toBe(
      'Link R4-R9 down, converged in 3000 ms (7 packets lost, 1 routing message)',
    )
    expect(
      describeChange({
        ...record,
        up: true,
        convergenceMs: null,
        packetsLost: 1,
        controlMessagesSent: 0,
      }),
    ).toBe('Link R4-R9 up: no routes needed to change (1 packet lost, 0 routing messages)')
  })

  it('describes a manually sent packet once it has finished', () => {
    const packet: Packet = {
      id: 1,
      src: 'R0',
      dst: 'R2',
      sizeBytes: 600,
      priority: 'video',
      createdAt: 100,
      ttl: 30,
      hops: ['R0', 'R1'],
      status: 'propagating',
    }
    expect(describePacket(packet)).toBeNull()
    expect(
      describePacket({
        ...packet,
        status: 'delivered',
        finishedAt: 412.6,
        hops: ['R0', 'R1', 'R2'],
      }),
    ).toBe('Packet R0 → R2 delivered in 313 ms over 2 hops')
    expect(describePacket({ ...packet, status: 'dropped', dropReason: 'queue-full' })).toBe(
      'Packet R0 → R2 dropped at R1 (queue-full)',
    )
  })
})

describe('count-to-infinity scenario in the live view', () => {
  it('builds A-B-C with slow links, distance-vector and a short TTL', () => {
    const { sim, topology } = createSimulation({
      ...DEFAULT_LIVE_SETTINGS,
      ...COUNT_TO_INFINITY_SETTINGS,
      topology: { ...DEFAULT_LIVE_SETTINGS.topology, preset: 'count-to-infinity' },
    })
    expect(topology.graph.nodes()).toEqual(['A', 'B', 'C'])
    expect(topology.graph.edges().every((e) => e.delayMs === COUNT_TO_INFINITY_DELAY_MS)).toBe(true)
    expect(sim.config).toMatchObject({
      routing: 'distance-vector',
      splitHorizon: false,
      poisonReverse: false,
      defaultTtl: COUNT_TO_INFINITY_TTL,
      packetsPerSecond: COUNT_TO_INFINITY_SETTINGS.packetsPerSecond,
    })
  })

  it('counts to 16 after B-C is cut, one step per link delay', () => {
    const { sim } = createSimulation({
      ...DEFAULT_LIVE_SETTINGS,
      ...COUNT_TO_INFINITY_SETTINGS,
      topology: { ...DEFAULT_LIVE_SETTINGS.topology, preset: 'count-to-infinity' },
    })
    sim.runUntil(10_000)
    sim.schedule(10_000, { type: 'LINK_DOWN', linkId: 'B-C' })
    sim.runUntil(30_000)
    const [record] = sim.convergenceRecords()
    // 1 s to notice, then 14 steps of 400 ms.
    expect(record.convergenceMs).toBe(
      LIVE_SIM_CONFIG.detectionDelayMs + 14 * COUNT_TO_INFINITY_DELAY_MS,
    )
    expect(sim.stats.counters.dropsByReason['ttl-expired']).toBeGreaterThan(0)
    const tables = sim.routingTables()
    expect(tables.A.find((e) => e.destination === 'C')).toMatchObject({
      cost: 16,
      reachable: false,
    })
  })
})
