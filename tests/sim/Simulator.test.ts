import { describe, expect, it } from 'vitest'
import { dijkstra } from '../../src/algo/dijkstra.ts'
import { Graph } from '../../src/ds/Graph.ts'
import type { SimConfig } from '../../src/sim/config.ts'
import { Rng } from '../../src/sim/rng.ts'
import { Simulator } from '../../src/sim/Simulator.ts'
import { randomPair } from '../../src/sim/traffic.ts'

/** No automatic traffic and no stats samples: only the events a test creates. */
const QUIET: Partial<SimConfig> = { packetsPerSecond: 0, statsIntervalMs: 0 }

/**
 * A - B - C with 1 Mbps and 5 ms on each link. A 1000-byte packet takes
 * 1000 * 8 / 1,000,000 s = 8 ms to transmit, then 5 ms to cross the link: 13 ms per hop.
 */
function lineGraph(): Graph {
  const graph = new Graph()
  for (const node of ['A', 'B', 'C']) graph.addNode(node)
  graph.addEdge('A', 'B', { id: 'ab', bandwidthBps: 1_000_000, delayMs: 5 })
  graph.addEdge('B', 'C', { id: 'bc', bandwidthBps: 1_000_000, delayMs: 5 })
  return graph
}

/**
 * Random network: a random tree (so every router can reach every other) plus extra links.
 * Costs are random floats, so shortest paths are unique. With `island`, one extra router has
 * no links at all, so traffic to or from it has no route.
 */
function randomNetwork(rng: Rng, n: number, island = false): Graph {
  const graph = new Graph()
  for (let i = 0; i < n; i++) graph.addNode(`r${i}`)
  const link = (a: number, b: number) =>
    graph.addEdge(`r${a}`, `r${b}`, {
      cost: rng.uniform(1, 10),
      bandwidthBps: rng.pick([100_000, 1_000_000, 10_000_000]),
      delayMs: rng.randomInt(0, 20),
    })
  for (let i = 1; i < n; i++) link(i, rng.randomInt(0, i - 1))
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (graph.edgeBetween(`r${a}`, `r${b}`) === undefined && rng.uniform() < 0.15) link(a, b)
    }
  }
  if (island) graph.addNode('island')
  return graph
}

describe('Simulator: latency on a 3-router line', () => {
  it('delivers a packet after transmission + propagation on each hop', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    const packet = sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    sim.runUntil(100)
    expect(packet.status).toBe('delivered')
    expect(packet.finishedAt).toBe(26) // (8 + 5) + (8 + 5)
    expect(packet.hops).toEqual(['A', 'B', 'C'])
    expect(packet.ttl).toBe(sim.config.defaultTtl - 2)
    expect(sim.stats.counters).toMatchObject({
      generated: 1,
      delivered: 1,
      dropped: 0,
      inFlight: 0,
    })
    expect(sim.stats.counters.totalLatencyMs).toBe(26)
  })

  it('processes exactly the expected events, one per step', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    const seen: string[] = []
    for (let next = sim.step(); next !== undefined; next = sim.step()) {
      seen.push(`${next.time} ${next.event.type}`)
    }
    expect(seen).toEqual([
      '8 TX_COMPLETE', // A finishes sending onto A-B
      '13 PACKET_ARRIVE', // ...and it reaches B 5 ms later
      '21 TX_COMPLETE', // B finishes sending onto B-C
      '26 PACKET_ARRIVE', // ...and it reaches C
    ])
    expect(sim.now).toBe(26)
  })

  it('uses each link’s own bandwidth and delay', () => {
    const graph = new Graph()
    for (const node of ['A', 'B', 'C']) graph.addNode(node)
    graph.addEdge('A', 'B', { bandwidthBps: 1_000_000, delayMs: 5 }) // 8 + 5
    graph.addEdge('B', 'C', { bandwidthBps: 2_000_000, delayMs: 10 }) // 4 + 10
    const sim = new Simulator(graph, QUIET)
    const packet = sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    sim.runUntil(100)
    expect(packet.finishedAt).toBe(27)
  })

  it('makes a second packet wait for the first (store and forward)', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    const first = sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    const second = sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    sim.runUntil(100)
    expect(first.finishedAt).toBe(26)
    // Waits 8 ms at A; then it is always 8 ms behind the first packet.
    expect(second.finishedAt).toBe(34)
  })

  it('handles events at exactly the runUntil time, and none after it', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    const packet = sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    sim.runUntil(25.9)
    expect(packet.status).toBe('propagating')
    expect(sim.now).toBe(25.9)
    sim.runUntil(26)
    expect(packet.status).toBe('delivered')
  })

  it('matches a hop-by-hop reference on 100 random networks', () => {
    const rng = new Rng(606)
    const problems: string[] = []
    for (let trial = 0; trial < 100; trial++) {
      const graph = randomNetwork(rng, rng.randomInt(2, 15))
      const sim = new Simulator(graph, QUIET)
      const { src, dst } = randomPair(rng, graph.nodes())
      const sizeBytes = rng.randomInt(64, 1500)
      const packet = sim.sendPacket(src, dst, { sizeBytes })
      sim.runUntil(1_000_000)

      // Reference: add transmission then propagation for each link on the path taken.
      let expected = 0
      let pathCost = 0
      for (let i = 0; i + 1 < packet.hops.length; i++) {
        const edge = graph.edgeBetween(packet.hops[i], packet.hops[i + 1])
        if (edge === undefined) {
          problems.push(`trial ${trial}: hop ${packet.hops[i]}-${packet.hops[i + 1]} is not a link`)
          continue
        }
        expected += (sizeBytes * 8 * 1000) / edge.bandwidthBps
        expected += edge.delayMs
        pathCost += edge.cost
      }
      if (packet.status !== 'delivered') problems.push(`trial ${trial}: ${packet.status}`)
      if (packet.finishedAt !== expected) {
        problems.push(`trial ${trial}: latency ${packet.finishedAt}, expected ${expected}`)
      }
      const shortest = dijkstra(graph, src).dist.get(dst) as number
      if (Math.abs(pathCost - shortest) > 1e-9) {
        problems.push(`trial ${trial}: path cost ${pathCost}, shortest is ${shortest}`)
      }
    }
    expect(problems).toEqual([])
  })
})

describe('Simulator: drops', () => {
  it('drops packets that arrive at a full queue (drop-tail)', () => {
    const sim = new Simulator(lineGraph(), { ...QUIET, queueCapacity: 2 })
    const packets = Array.from({ length: 5 }, () => sim.sendPacket('A', 'C', { sizeBytes: 1000 }))
    // Packet 1 goes straight onto the link, 2 and 3 fill the queue, 4 and 5 are dropped.
    expect(packets.map((p) => p.status)).toEqual([
      'transmitting',
      'queued',
      'queued',
      'dropped',
      'dropped',
    ])
    expect(packets[3].dropReason).toBe('queue-full')
    sim.runUntil(1_000)
    expect(packets.map((p) => p.status)).toEqual([
      'delivered',
      'delivered',
      'delivered',
      'dropped',
      'dropped',
    ])
    expect(sim.stats.counters).toMatchObject({
      generated: 5,
      delivered: 3,
      dropped: 2,
      inFlight: 0,
    })
    expect(sim.stats.counters.dropsByReason['queue-full']).toBe(2)
  })

  it('drops a packet whose TTL runs out before its destination', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    const short = sim.sendPacket('A', 'C', { ttl: 1 })
    const enough = sim.sendPacket('A', 'C', { ttl: 2 })
    sim.runUntil(1_000)
    expect(short.status).toBe('dropped')
    expect(short.dropReason).toBe('ttl-expired')
    expect(short.hops).toEqual(['A', 'B'])
    expect(enough.status).toBe('delivered')
    expect(enough.ttl).toBe(0)
  })

  it('drops a packet with no route at its source', () => {
    const graph = lineGraph()
    graph.addNode('D')
    const sim = new Simulator(graph, QUIET)
    const packet = sim.sendPacket('A', 'D')
    expect(packet.status).toBe('dropped')
    expect(packet.dropReason).toBe('no-route')
    expect(packet.hops).toEqual(['A'])
    expect(packet.finishedAt).toBe(0)
  })
})

describe('Simulator: links going down and up', () => {
  /** A change is noticed 20 ms later; link-state then floods the news over the 5 ms links. */
  const FAST: Partial<SimConfig> = { ...QUIET, detectionDelayMs: 20 }

  it('keeps forwarding along the old route until the routers hear about the failure', () => {
    const sim = new Simulator(lineGraph(), FAST)
    sim.schedule(0, { type: 'LINK_DOWN', linkId: 'bc' })
    sim.runUntil(0)
    const early = sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    sim.runUntil(19)
    // B still routes C over the dead link, so the packet waits in that queue.
    expect(early.status).toBe('queued')
    expect(early.hops).toEqual(['A', 'B'])
    sim.runUntil(20) // B notices, and finds it has no route to C any more
    expect(early.dropReason).toBe('no-route')
    expect(early.finishedAt).toBe(20)

    sim.runUntil(25) // B's LSA has reached A
    const late = sim.sendPacket('A', 'C')
    expect(late.dropReason).toBe('no-route') // A knows too
    expect(late.hops).toEqual(['A'])
  })

  it('keeps packets queued for a failed link, then drops them if routes show no path', () => {
    const sim = new Simulator(lineGraph(), { ...FAST, queueCapacity: 5 })
    const packets = [1, 2, 3].map(() => sim.sendPacket('A', 'C', { sizeBytes: 1000 }))
    sim.schedule(1, { type: 'LINK_DOWN', linkId: 'ab' })
    sim.runUntil(20)
    expect(packets.map((p) => p.status)).toEqual(['dropped', 'queued', 'queued'])
    expect(packets[0].dropReason).toBe('link-failure') // it was being transmitted
    sim.runUntil(21) // 1 + 20: A notices, and has no other way to C
    expect(packets.map((p) => p.dropReason)).toEqual(['link-failure', 'no-route', 'no-route'])
    expect(sim.snapshot().routers.find((r) => r.id === 'A')?.queued).toBe(0)
  })

  it('sends queued packets as soon as the link comes back up', () => {
    const sim = new Simulator(lineGraph(), { ...FAST, queueCapacity: 5 })
    const packets = [1, 2, 3].map(() => sim.sendPacket('A', 'C', { sizeBytes: 1000 }))
    sim.schedule(1, { type: 'LINK_DOWN', linkId: 'ab' })
    sim.schedule(10, { type: 'LINK_UP', linkId: 'ab' }) // back before anyone notices at 21
    sim.runUntil(1_000)
    expect(packets.map((p) => p.status)).toEqual(['dropped', 'delivered', 'delivered'])
    // Packet 2 starts at 10: 10 + 13 + 13 = 36. Packet 3 follows 8 ms behind.
    expect(packets.map((p) => p.finishedAt)).toEqual([1, 36, 44])
    // The routers notice the failure at 21, when the link is already back, so they reroute
    // anyway, and then notice the repair at 30 and route back: both changes moved tables.
    expect(sim.convergenceRecords().map((r) => r.convergenceMs)).toEqual([25, 25])
  })

  it('drops a packet that is mid-transmission and ignores its stale TX_COMPLETE', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    sim.schedule(4, { type: 'LINK_DOWN', linkId: 'ab' }) // A is sending from 0 to 8
    sim.schedule(10, { type: 'LINK_UP', linkId: 'ab' })
    const first = sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    sim.runUntil(10) // the TX_COMPLETE at 8 is stale and must change nothing
    expect(first.status).toBe('dropped')
    expect(first.dropReason).toBe('link-failure')
    expect(first.finishedAt).toBe(4)
    expect(sim.stats.counters).toMatchObject({ dropped: 1, delivered: 0, inFlight: 0 })
    expect(sim.snapshot().links.find((l) => l.id === 'ab')?.aToB.busy).toBe(false)

    const second = sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    sim.runUntil(100)
    expect(second.status).toBe('delivered')
    expect(second.finishedAt).toBe(36)
  })

  it('drops a packet that is travelling along the link and ignores its stale PACKET_ARRIVE', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    sim.schedule(10, { type: 'LINK_DOWN', linkId: 'ab' }) // sent by 8, would arrive at 13
    const packet = sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    sim.runUntil(100)
    expect(packet.status).toBe('dropped')
    expect(packet.dropReason).toBe('link-failure')
    expect(packet.finishedAt).toBe(10)
    expect(packet.hops).toEqual(['A'])
    expect(sim.stats.counters).toMatchObject({ generated: 1, dropped: 1, inFlight: 0 })
  })

  it('does not change the graph it was given', () => {
    const graph = lineGraph()
    const sim = new Simulator(graph, QUIET)
    sim.schedule(1, { type: 'LINK_DOWN', linkId: 'ab' })
    sim.runUntil(2)
    expect(sim.graph.getEdge('ab')?.up).toBe(false)
    expect(graph.getEdge('ab')?.up).toBe(true)
  })
})

describe('Simulator: snapshot and samples', () => {
  it('shows a packet on its link with depart and arrive times', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    sim.runUntil(4)
    const during = sim.snapshot()
    expect(during.time).toBe(4)
    expect(during.packets).toEqual([
      {
        id: 1,
        src: 'A',
        dst: 'C',
        priority: 'web',
        status: 'transmitting',
        linkId: 'ab',
        from: 'A',
        to: 'B',
        departTime: 0,
        arriveTime: 13,
      },
    ])
    const ab = during.links.find((l) => l.id === 'ab')
    expect(ab?.aToB.busy).toBe(true)
    expect(ab?.bToA.busy).toBe(false)

    sim.runUntil(10)
    expect(sim.snapshot().packets[0].status).toBe('propagating')
    sim.runUntil(15)
    expect(sim.snapshot().packets[0]).toMatchObject({ from: 'B', to: 'C', departTime: 13 })
  })

  it('shows queue lengths on routers and link directions', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    for (let i = 0; i < 3; i++) sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    const snap = sim.snapshot()
    expect(snap.routers.find((r) => r.id === 'A')).toEqual({
      id: 'A',
      queued: 2,
      queueLengths: { B: 2 },
    })
    expect(snap.links.find((l) => l.id === 'ab')?.aToB.queueLength).toBe(2)
  })

  it('is plain data that survives structuredClone (for a Web Worker)', () => {
    const sim = new Simulator(lineGraph(), { seed: 3 })
    sim.runUntil(500)
    const snap = sim.snapshot()
    expect(structuredClone(snap)).toEqual(snap)
  })

  it('samples stats and link utilisation every statsIntervalMs', () => {
    const sim = new Simulator(lineGraph(), { ...QUIET, statsIntervalMs: 100 })
    sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    sim.runUntil(100)
    const links = sim.snapshot().links
    const ab = links.find((l) => l.id === 'ab')
    const bc = links.find((l) => l.id === 'bc')
    expect(ab?.aToB.utilisation).toBeCloseTo(0.08, 12) // busy 8 ms of 100
    expect(ab?.bToA.utilisation).toBe(0)
    expect(bc?.aToB.utilisation).toBeCloseTo(0.08, 12)
    expect([...sim.stats.network]).toEqual([
      {
        time: 100,
        generated: 1,
        delivered: 1,
        dropped: 0,
        inFlight: 0,
        queued: 0,
        dropsByReason: { 'ttl-expired': 0, 'no-route': 0, 'queue-full': 0, 'link-failure': 0 },
        count: 1,
        avgLatencyMs: 26,
        p95LatencyMs: 26,
        throughputPps: 10, // 1 packet in the first 0.1 s
        byPriority: {
          video: { count: 0, avgLatencyMs: null, p95LatencyMs: null },
          web: { count: 1, avgLatencyMs: 26, p95LatencyMs: 26 },
          bulk: { count: 0, avgLatencyMs: null, p95LatencyMs: null },
        },
      },
    ])
    expect([...(sim.stats.linkUtilisation.get('ab') ?? [])]).toEqual([{ time: 100, value: 0.08 }])
    expect([...(sim.stats.routerQueues.get('A') ?? [])]).toEqual([{ time: 100, value: 0 }])
    expect(sim.snapshot().latestSample?.time).toBe(100)
  })

  it('keeps only the newest maxSamples samples in every series', () => {
    const sim = new Simulator(lineGraph(), { ...QUIET, statsIntervalMs: 10, maxSamples: 3 })
    sim.runUntil(100)
    expect([...sim.stats.network].map((s) => s.time)).toEqual([80, 90, 100])
    expect([...(sim.stats.routerQueues.get('B') ?? [])].map((p) => p.time)).toEqual([80, 90, 100])
    expect([...(sim.stats.linkUtilisation.get('bc') ?? [])].length).toBe(3)
  })

  it('samples every 250 ms and keeps 300 samples by default', () => {
    const sim = new Simulator(lineGraph(), { packetsPerSecond: 0 })
    sim.runUntil(100_000)
    const times = [...sim.stats.network].map((s) => s.time)
    expect(times.length).toBe(300)
    expect(times[times.length - 1]).toBe(100_000)
    expect(times[1] - times[0]).toBe(250)
  })
})

describe('Simulator: Poisson traffic', () => {
  it('generates packetsPerSecond packets per simulated second on average', () => {
    const sim = new Simulator(lineGraph(), { seed: 5, packetsPerSecond: 500, statsIntervalMs: 0 })
    sim.runUntil(10_000) // 10 s, so about 5000 packets
    expect(Math.abs(sim.stats.counters.generated - 5_000)).toBeLessThan(250)
  })

  it('gives identical results for the same seed and different ones for another seed', () => {
    const network = randomNetwork(new Rng(7), 10)
    const linkId = network.edges()[0].id
    const run = (seed: number) => {
      const sim = new Simulator(network, {
        seed,
        packetsPerSecond: 2_000,
        queueCapacity: 4,
        statsIntervalMs: 50,
      })
      sim.schedule(200, { type: 'LINK_DOWN', linkId })
      sim.schedule(400, { type: 'LINK_UP', linkId })
      sim.runUntil(1_000)
      return { stats: sim.stats, samples: [...sim.stats.network], snapshot: sim.snapshot() }
    }
    const first = run(42)
    expect(first.stats.counters.generated).toBeGreaterThan(1_000)
    expect(run(42)).toEqual(first)
    expect(run(43).stats.counters).not.toEqual(first.stats.counters)
  })
})

describe('Simulator: packet accounting', () => {
  it('after every runUntil, generated = delivered + dropped + inFlight, and inFlight matches what is in the network', () => {
    const rng = new Rng(808)
    const problems: string[] = []
    const reasonsSeen = new Set<string>()

    for (let trial = 0; trial < 20; trial++) {
      const network = randomNetwork(rng, rng.randomInt(3, 12), trial % 2 === 0)
      const sim = new Simulator(network, {
        seed: trial,
        packetsPerSecond: rng.randomInt(500, 5_000),
        queueCapacity: rng.randomInt(1, 6),
        defaultTtl: rng.randomInt(1, 6),
        statsIntervalMs: 25,
      })
      // Random link failures and repairs.
      const linkIds = network.edges().map((edge) => edge.id)
      for (let i = 0; i < 10; i++) {
        const type = rng.uniform() < 0.5 ? 'LINK_DOWN' : 'LINK_UP'
        sim.schedule(rng.uniform(0, 1_000), { type, linkId: rng.pick(linkIds) })
      }

      for (let time = 0; time <= 1_000; time += 37) {
        sim.runUntil(time)
        const { stats, routers, packets } = sim.snapshot()
        const queued = routers.reduce((sum, router) => sum + router.queued, 0)
        const byReason = Object.values(stats.dropsByReason).reduce((sum, n) => sum + n, 0)
        const at = `trial ${trial}, t=${time}`
        if (stats.generated !== stats.delivered + stats.dropped + stats.inFlight) {
          problems.push(`${at}: ${JSON.stringify(stats)} does not add up`)
        }
        if (stats.inFlight !== queued + packets.length) {
          problems.push(
            `${at}: inFlight ${stats.inFlight} but ${queued} queued + ${packets.length} on links`,
          )
        }
        if (byReason !== stats.dropped) problems.push(`${at}: drop reasons sum to ${byReason}`)
        for (const packet of packets) {
          if (packet.status !== 'transmitting' && packet.status !== 'propagating') {
            problems.push(`${at}: packet ${packet.id} on a link has status ${packet.status}`)
          }
        }
      }
      for (const [reason, count] of Object.entries(sim.stats.counters.dropsByReason)) {
        if (count > 0) reasonsSeen.add(reason)
      }
    }

    expect(problems).toEqual([])
    // Make sure the runs really exercised every kind of drop.
    expect([...reasonsSeen].sort()).toEqual([
      'link-failure',
      'no-route',
      'queue-full',
      'ttl-expired',
    ])
  })
})

describe('Simulator: argument checks', () => {
  it('rejects bad sends, past times and unknown links', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    expect(() => sim.sendPacket('A', 'A')).toThrow('different from its source')
    expect(() => sim.sendPacket('A', 'Z')).toThrow('unknown router')
    expect(() => sim.sendPacket('A', 'C', { sizeBytes: 0 })).toThrow(RangeError)
    expect(() => sim.sendPacket('A', 'C', { ttl: -1 })).toThrow(RangeError)
    expect(() => sim.schedule(1, { type: 'LINK_DOWN', linkId: 'nope' })).toThrow('unknown link')
    sim.runUntil(50)
    expect(() => sim.runUntil(10)).toThrow(RangeError)
    expect(() => sim.schedule(10, { type: 'STATS_SAMPLE' })).toThrow(RangeError)
  })

  it('step returns undefined when there is nothing to do', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    expect(sim.step()).toBeUndefined()
    expect(sim.now).toBe(0)
  })

  it('works on a network with a single router', () => {
    const graph = new Graph()
    graph.addNode('only')
    const sim = new Simulator(graph, { packetsPerSecond: 100 })
    sim.runUntil(1_000)
    expect(sim.stats.counters.generated).toBe(0) // no pair of routers to send between
  })
})

describe('Simulator: advanceUntil (bounded runUntil)', () => {
  it('stops after maxEvents and reports that it did not get there', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    sim.sendPacket('A', 'C', { sizeBytes: 1000 }) // events at 8, 13, 21 and 26
    expect(sim.advanceUntil(100, 2)).toBe(false)
    expect(sim.now).toBe(13) // the time of the last event processed
    expect(sim.advanceUntil(100, 2)).toBe(true) // the last two events, then on to 100
    expect(sim.now).toBe(100)
    expect(sim.stats.counters.delivered).toBe(1)
  })

  it('reaches the target with exactly enough events, and handles zero', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    sim.sendPacket('A', 'C', { sizeBytes: 1000 })
    expect(sim.advanceUntil(5, 0)).toBe(true) // nothing due before 5
    expect(sim.advanceUntil(30, 0)).toBe(false)
    expect(sim.now).toBe(5)
    expect(sim.advanceUntil(30, 4)).toBe(true)
    expect(sim.now).toBe(30)
  })

  it('rejects a time in the past', () => {
    const sim = new Simulator(lineGraph(), QUIET)
    sim.runUntil(10)
    expect(() => sim.advanceUntil(5, 10)).toThrow(RangeError)
  })
})

describe('Simulator: setTraffic (changing traffic while running)', () => {
  const generatedBetween = (sim: Simulator, from: number, to: number) => {
    sim.runUntil(from)
    const before = sim.stats.counters.generated
    sim.runUntil(to)
    return sim.stats.counters.generated - before
  }

  it('applies a new rate straight away', () => {
    const sim = new Simulator(lineGraph(), { seed: 3, packetsPerSecond: 100, statsIntervalMs: 0 })
    expect(Math.abs(generatedBetween(sim, 0, 10_000) - 1_000)).toBeLessThan(100)
    sim.setTraffic(1_000)
    expect(Math.abs(generatedBetween(sim, 10_000, 20_000) - 10_000)).toBeLessThan(400)
  })

  it('stops traffic at 0 and restarts it without doubling the rate', () => {
    const sim = new Simulator(lineGraph(), { seed: 4, packetsPerSecond: 200, statsIntervalMs: 0 })
    sim.runUntil(1_000)
    sim.setTraffic(0)
    expect(generatedBetween(sim, 1_000, 5_000)).toBe(0)
    // Switch off and on again before the old pending event fires: still only one stream.
    sim.setTraffic(200)
    sim.setTraffic(0)
    sim.setTraffic(200)
    expect(Math.abs(generatedBetween(sim, 5_000, 25_000) - 4_000)).toBeLessThan(300)
  })

  it('changes the priority mix', () => {
    const sim = new Simulator(lineGraph(), { seed: 5, packetsPerSecond: 50, statsIntervalMs: 0 })
    sim.runUntil(1_000)
    sim.setTraffic(50, { video: 1, web: 0, bulk: 0 })
    sim.runUntil(1_001) // past any packet already being created
    const snapshots: string[] = []
    for (let time = 1_100; time <= 5_000; time += 100) {
      sim.runUntil(time)
      for (const packet of sim.snapshot().packets) {
        if (packet.departTime > 1_001 && packet.src !== packet.dst) snapshots.push(packet.priority)
      }
    }
    expect(snapshots.length).toBeGreaterThan(20)
    expect(new Set(snapshots)).toEqual(new Set(['video']))
  })

  it('rejects invalid traffic and leaves the settings as they were', () => {
    const sim = new Simulator(lineGraph(), { packetsPerSecond: 10 })
    expect(() => sim.setTraffic(-1)).toThrow(RangeError)
    expect(() => sim.setTraffic(10, { video: 0, web: 0, bulk: 0 })).toThrow(RangeError)
    expect(sim.config.packetsPerSecond).toBe(10)
    expect(sim.config.priorityMix).toEqual({ video: 0.2, web: 0.5, bulk: 0.3 })
  })
})
