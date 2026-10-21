import { describe, expect, it } from 'vitest'
import { Rng } from '../../src/sim/rng.ts'
import { percentile, StatsCollector } from '../../src/sim/stats.ts'

describe('percentile (nearest rank)', () => {
  it('picks the value at rank ceil(p/100 * n)', () => {
    const oneTo = (n: number) => Array.from({ length: n }, (_, i) => i + 1)
    expect(percentile(oneTo(100), 95)).toBe(95)
    expect(percentile(oneTo(20), 95)).toBe(19)
    expect(percentile(oneTo(4), 95)).toBe(4)
    expect(percentile([7], 95)).toBe(7)
    expect(percentile(oneTo(10), 0)).toBe(1)
    expect(percentile(oneTo(10), 100)).toBe(10)
  })
})

describe('StatsCollector', () => {
  it('counts generated, delivered, dropped by reason and in flight', () => {
    const stats = new StatsCollector(5_000, 10)
    for (let i = 0; i < 4; i++) stats.packetGenerated()
    stats.packetDelivered(10, 7)
    stats.packetDropped('queue-full')
    stats.packetDropped('no-route')
    expect(stats.counters).toEqual({
      generated: 4,
      delivered: 1,
      dropped: 2,
      inFlight: 1,
      dropsByReason: { 'ttl-expired': 0, 'no-route': 1, 'queue-full': 1, 'link-failure': 0 },
      totalLatencyMs: 7,
      deliveredByPriority: { video: 0, web: 1, bulk: 0 },
      droppedByPriority: { video: 0, web: 2, bulk: 0 },
      latencyByPriority: { video: 0, web: 7, bulk: 0 },
    })
  })

  it('has no latency figures before anything is delivered', () => {
    const stats = new StatsCollector(5_000, 10)
    expect(stats.windowStats(0)).toEqual({
      count: 0,
      avgLatencyMs: null,
      p95LatencyMs: null,
      throughputPps: 0,
      byPriority: {
        video: { count: 0, avgLatencyMs: null, p95LatencyMs: null },
        web: { count: 0, avgLatencyMs: null, p95LatencyMs: null },
        bulk: { count: 0, avgLatencyMs: null, p95LatencyMs: null },
      },
    })
    expect(stats.windowStats(1_000).throughputPps).toBe(0)
    expect(stats.latest).toBeNull()
  })

  it('computes average, p95 and throughput over the window', () => {
    const stats = new StatsCollector(5_000, 10)
    stats.packetDelivered(100, 10)
    stats.packetDelivered(200, 20)
    stats.packetDelivered(300, 30)
    stats.packetDelivered(400, 40)
    expect(stats.windowStats(400)).toMatchObject({
      count: 4,
      avgLatencyMs: 25,
      p95LatencyMs: 40,
      throughputPps: 10, // 4 packets in the first 0.4 s
    })
  })

  it('forgets deliveries older than the window', () => {
    const stats = new StatsCollector(5_000, 10)
    stats.packetDelivered(0, 100)
    stats.packetDelivered(4_000, 10)
    stats.packetDelivered(6_000, 20)
    // At 6000 the window is (1000, 6000]: the delivery at 0 is gone.
    expect(stats.windowStats(6_000)).toMatchObject({ count: 2, avgLatencyMs: 15 })
    expect(stats.windowStats(6_000).throughputPps).toBeCloseTo(2 / 5, 12)
    expect(stats.windowStats(9_000)).toMatchObject({ count: 1, avgLatencyMs: 20 }) // (4000, 9000]
    expect(stats.counters.delivered).toBe(3) // the counters keep everything
  })

  it('treats the window as (now - windowMs, now]', () => {
    const stats = new StatsCollector(5_000, 10)
    stats.packetDelivered(1_000, 5)
    expect(stats.windowStats(5_999).count).toBe(1)
    expect(stats.windowStats(6_000).count).toBe(0) // exactly 5 s old: just left the window
  })

  it('records network, router and link samples', () => {
    const stats = new StatsCollector(5_000, 10)
    stats.packetGenerated()
    stats.packetDelivered(100, 12)
    const sample = stats.sample(
      250,
      [
        ['A', 3],
        ['B', 0],
      ],
      [['ab', 0.5]],
    )
    expect(sample).toMatchObject({ time: 250, generated: 1, delivered: 1, avgLatencyMs: 12 })
    expect(stats.latest).toBe(sample)
    expect([...stats.network]).toEqual([sample])
    expect([...(stats.routerQueues.get('A') ?? [])]).toEqual([{ time: 250, value: 3 }])
    expect([...(stats.linkUtilisation.get('ab') ?? [])]).toEqual([{ time: 250, value: 0.5 }])
  })

  it('keeps only the newest maxSamples points in every series', () => {
    const stats = new StatsCollector(5_000, 3)
    for (let t = 1; t <= 5; t++) stats.sample(t * 250, [['A', t]], [['ab', t / 10]])
    expect([...stats.network].map((s) => s.time)).toEqual([750, 1_000, 1_250])
    expect([...(stats.routerQueues.get('A') ?? [])].map((p) => p.value)).toEqual([3, 4, 5])
    expect([...(stats.linkUtilisation.get('ab') ?? [])].length).toBe(3)
  })

  it('matches a filter-and-sort reference over random deliveries', () => {
    const rng = new Rng(3131)
    const windowMs = 5_000
    const stats = new StatsCollector(windowMs, 10)
    const all: { time: number; latencyMs: number }[] = []
    const problems: string[] = []
    let time = 0
    for (let step = 0; step < 3_000; step++) {
      time += rng.exponential(1 / 20) // a delivery every 20 ms on average
      const latencyMs = rng.uniform(1, 100)
      stats.packetDelivered(time, latencyMs)
      all.push({ time, latencyMs })

      if (step % 50 === 0) {
        const now = time + rng.uniform(0, 3_000)
        // Reference: keep deliveries in (now - window, now], sort, and take the nearest rank.
        const inWindow = all.filter((d) => d.time > now - windowMs).map((d) => d.latencyMs)
        inWindow.sort((a, b) => a - b)
        const got = stats.windowStats(now)
        const span = Math.min(windowMs, now) / 1000
        const avg = inWindow.reduce((sum, v) => sum + v, 0) / inWindow.length
        const p95 = inWindow[Math.ceil(0.95 * inWindow.length) - 1]
        if (got.count !== inWindow.length) problems.push(`t=${now}: count ${got.count}`)
        if (Math.abs((got.avgLatencyMs ?? NaN) - avg) > 1e-9) problems.push(`t=${now}: avg`)
        if (got.p95LatencyMs !== p95) problems.push(`t=${now}: p95`)
        if (Math.abs(got.throughputPps - inWindow.length / span) > 1e-9)
          problems.push(`t=${now}: pps`)
        time = now // deliveries continue from the query time, so time never goes back
      }
    }
    expect(problems).toEqual([])
  })
})

describe('StatsCollector per traffic class', () => {
  it('splits latency and counts by priority', () => {
    const stats = new StatsCollector(5_000, 10)
    for (let i = 0; i < 5; i++) stats.packetGenerated()
    stats.packetDelivered(10, 4, 'video')
    stats.packetDelivered(20, 6, 'video')
    stats.packetDelivered(30, 50, 'bulk')
    stats.packetDropped('queue-full', 'bulk')
    stats.packetDropped('queue-full', 'web')
    const window = stats.windowStats(100)
    expect(window.byPriority).toEqual({
      video: { count: 2, avgLatencyMs: 5, p95LatencyMs: 6 },
      web: { count: 0, avgLatencyMs: null, p95LatencyMs: null },
      bulk: { count: 1, avgLatencyMs: 50, p95LatencyMs: 50 },
    })
    expect(stats.counters.deliveredByPriority).toEqual({ video: 2, web: 0, bulk: 1 })
    expect(stats.counters.droppedByPriority).toEqual({ video: 0, web: 1, bulk: 1 })
    expect(stats.counters.latencyByPriority).toEqual({ video: 10, web: 0, bulk: 50 })
  })
})
