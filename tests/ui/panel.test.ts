import { describe, expect, it } from 'vitest'
import { createConvergenceRecord } from '../../src/sim/convergence.ts'
import { Simulator } from '../../src/sim/Simulator.ts'
import type { NetworkSample } from '../../src/sim/stats.ts'
import { line, ring } from '../../src/topology/presets.ts'
import {
  buildPanelData,
  chartFrom,
  deliveryPercent,
  HISTORY_LENGTH,
  historyFrom,
  RECENT_CHANGES,
} from '../../src/ui/panel.ts'
import { createSimulation, DEFAULT_LIVE_SETTINGS, toggleLink } from '../../src/ui/simulation.ts'

describe('buildPanelData', () => {
  it('summarises the snapshot for the side panel', () => {
    const sim = new Simulator(ring(6).graph, { packetsPerSecond: 0, statsIntervalMs: 0 })
    for (let i = 0; i < 4; i++) sim.sendPacket('R0', 'R3')
    for (let i = 0; i < 6; i++) {
      sim.schedule(i * 10, { type: i % 2 === 0 ? 'LINK_DOWN' : 'LINK_UP', linkId: 'R3-R4' })
    }
    sim.schedule(55, { type: 'LINK_DOWN', linkId: 'R4-R5' })
    sim.runUntil(60)
    const data = buildPanelData(sim.snapshot(), sim.stats.windowStats(sim.now))
    expect(data.simTimeMs).toBe(60)
    expect(data.linksDown).toBe(1) // R3-R4 ended up, R4-R5 down
    expect(data.counters.generated).toBe(4)
    expect(data.recentChanges.length).toBe(RECENT_CHANGES)
    expect(data.recentChanges[0].linkId).toBe('R4-R5') // newest first
    expect(data.queuedPackets + data.packetsOnLinks).toBe(data.counters.inFlight)
  })
})

describe('live simulation setup', () => {
  it('starts the 5x5 grid with traffic running', () => {
    const { sim, topology } = createSimulation()
    expect(topology.name).toBe('grid 5x5')
    expect(sim.config.packetsPerSecond).toBe(DEFAULT_LIVE_SETTINGS.packetsPerSecond)
    sim.runUntil(1_000)
    expect(sim.stats.counters.generated).toBeGreaterThan(50) // about 80 per second
  })

  it('toggleLink cuts and restores a link immediately', () => {
    const simulation = createSimulation()
    toggleLink(simulation, 'R0-R1')
    expect(simulation.sim.links.get('R0-R1')?.up).toBe(false)
    toggleLink(simulation, 'R0-R1')
    expect(simulation.sim.links.get('R0-R1')?.up).toBe(true)
    toggleLink(simulation, 'no-such-link') // ignored
    expect(simulation.sim.convergenceRecords().length).toBe(2)
  })
})

describe('history for the sparklines', () => {
  const sample = (time: number, delivered: number, dropped: number) => ({
    time,
    generated: delivered + dropped,
    delivered,
    dropped,
    inFlight: 0,
    queued: 0,
    dropsByReason: { 'ttl-expired': 0, 'no-route': 0, 'queue-full': dropped, 'link-failure': 0 },
    count: 0,
    avgLatencyMs: 10,
    p95LatencyMs: 20,
    throughputPps: 5,
    byPriority: {
      video: { count: 0, avgLatencyMs: null, p95LatencyMs: null },
      web: { count: 0, avgLatencyMs: 10, p95LatencyMs: 20 },
      bulk: { count: 0, avgLatencyMs: null, p95LatencyMs: null },
    },
  })

  it('measures delivery % over the last DELIVERY_SPAN samples', () => {
    // Running totals: 10 delivered per sample, then 2 drops appear at sample 5.
    const samples = [0, 1, 2, 3, 4, 5, 6].map((i) => sample(i * 250, i * 10, i >= 5 ? 2 : 0))
    const history = historyFrom(samples)
    expect(history[0].deliveryPct).toBeNull() // nothing to compare the first sample with
    expect(history[1].deliveryPct).toBe(100)
    expect(history[4].deliveryPct).toBe(100) // samples 0..4: 40 delivered, 0 dropped
    // Samples 1..5: 40 delivered, 2 dropped.
    expect(history[5].deliveryPct).toBeCloseTo((100 * 40) / 42, 9)
    expect(history[6].p95LatencyMs).toBe(20)
  })

  it('keeps only the last HISTORY_LENGTH points', () => {
    const samples = Array.from({ length: 100 }, (_, i) => sample(i * 250, i * 10, 0))
    const sim = new Simulator(ring(4).graph, { packetsPerSecond: 0, statsIntervalMs: 0 })
    const data = buildPanelData(sim.snapshot(), sim.stats.windowStats(0), samples)
    expect(data.history.length).toBe(HISTORY_LENGTH)
    expect(data.history[HISTORY_LENGTH - 1].time).toBe(99 * 250)
    expect(data.history[0].deliveryPct).toBe(100) // its base sample was kept for the calculation
    expect(data.overallDeliveryPct).toBeNull() // this simulation has finished no packets
    expect(deliveryPercent(3, 1)).toBe(75)
  })
})

describe('routing tables in the panel', () => {
  it('passes every router table and the control counters through', () => {
    const sim = new Simulator(ring(4).graph, {
      packetsPerSecond: 0,
      statsIntervalMs: 0,
      routing: 'distance-vector',
    })
    sim.runUntil(3_000)
    const data = buildPanelData(
      sim.snapshot(),
      sim.stats.windowStats(sim.now),
      [],
      sim.routingTables(),
    )
    expect(data.protocol).toBe('distance-vector')
    expect(Object.keys(data.tables)).toEqual(['R0', 'R1', 'R2', 'R3'])
    expect(data.tables.R0.map((e) => e.destination).sort()).toEqual(['R1', 'R2', 'R3'])
    expect(data.control.sent).toBeGreaterThan(0)
  })
})

describe('chart data', () => {
  const ZERO = { count: 0, avgLatencyMs: null, p95LatencyMs: null }
  const sample = (time: number): NetworkSample => ({
    time,
    generated: 0,
    delivered: 0,
    dropped: 0,
    inFlight: 0,
    queued: time / 250,
    dropsByReason: { 'ttl-expired': 0, 'no-route': 0, 'queue-full': 0, 'link-failure': 0 },
    count: 0,
    avgLatencyMs: 10,
    p95LatencyMs: 20,
    throughputPps: 5,
    byPriority: { video: ZERO, web: ZERO, bulk: ZERO },
  })
  const every250 = (untilMs: number) =>
    Array.from({ length: untilMs / 250 }, (_, i) => sample((i + 1) * 250))

  it('shows a fixed 75 s window from the start, then scrolls with the clock', () => {
    const early = chartFrom(every250(10_000), [], 10_000, 75_000)
    expect([early.from, early.to]).toEqual([0, 75])
    expect(early.points.length).toBe(40)
    expect(early.points[0]).toEqual({ t: 0.25, avg: 10, p95: 20, throughput: 5, queued: 1 })

    const late = chartFrom(every250(100_000), [], 100_000, 75_000)
    expect([late.from, late.to]).toEqual([25, 100])
    expect(late.points[0].t).toBe(25)
    expect(late.points.length).toBe(75 * 4 + 1)
  })

  it('marks only the link changes inside the window', () => {
    const changes = [
      createConvergenceRecord(0, 'R1-R2', false, 10_000),
      createConvergenceRecord(1, 'R1-R2', true, 90_000),
    ]
    expect(chartFrom([], changes, 100_000, 75_000).markers).toEqual([
      { id: 1, t: 90, up: true, linkId: 'R1-R2' },
    ])
    // At 50 s only the cut has happened, and it is inside the first 75 s.
    expect(chartFrom([], changes.slice(0, 1), 50_000, 75_000).markers.map((m) => m.id)).toEqual([0])
  })

  it('reads the queued total from the simulator samples', () => {
    const sim = new Simulator(line(3).graph, { packetsPerSecond: 0, statsIntervalMs: 10 })
    for (let i = 0; i < 5; i++) sim.sendPacket('R0', 'R2', { sizeBytes: 100_000 }) // 80 ms each
    sim.runUntil(10)
    const chart = chartFrom([...sim.stats.network], sim.convergenceRecords(), sim.now, 3_000)
    expect(chart.points.map((p) => p.queued)).toEqual([4]) // one sending, four waiting at R0
  })
})
