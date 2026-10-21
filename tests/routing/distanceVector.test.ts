import { describe, expect, it } from 'vitest'
import { buildForwardingTable, dijkstra } from '../../src/algo/dijkstra.ts'
import { Graph, type NodeId } from '../../src/ds/Graph.ts'
import { DistanceVectorRouting, DV_INFINITY } from '../../src/routing/distanceVector.ts'
import type { ControlMessage, RoutingContext, RoutingTimer } from '../../src/routing/types.ts'
import type { SimConfig } from '../../src/sim/config.ts'
import { Rng } from '../../src/sim/rng.ts'
import { Simulator } from '../../src/sim/Simulator.ts'
import { countToInfinity } from '../../src/topology/presets.ts'

/** Distance-vector with no traffic or stats: only the events the test creates. */
const DV: Partial<SimConfig> = {
  packetsPerSecond: 0,
  statsIntervalMs: 0,
  routing: 'distance-vector',
  dvPeriodMs: 200,
  detectionDelayMs: 50,
}

/** `router`'s cost to `destination` from its routing table, or undefined if it has no entry. */
function costTo(sim: Simulator, router: NodeId, destination: NodeId): number | undefined {
  return sim.routing.routingTable(router).find((entry) => entry.destination === destination)?.cost
}

/**
 * Random network: a random tree plus extra links, some of them down. Costs are random floats
 * between 1 and 2.5, so shortest paths are unique, and delays are 1 to 5 ms.
 */
function randomNetwork(rng: Rng, n: number): Graph {
  const graph = new Graph()
  for (let i = 0; i < n; i++) graph.addNode(`r${i}`)
  const link = (a: number, b: number) =>
    graph.addEdge(`r${a}`, `r${b}`, {
      cost: rng.uniform(1, 2.5),
      delayMs: rng.randomInt(1, 5),
      up: rng.uniform() >= 0.1,
    })
  for (let i = 1; i < n; i++) link(i, rng.randomInt(0, i - 1))
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (graph.edgeBetween(`r${a}`, `r${b}`) === undefined && rng.uniform() < 0.2) link(a, b)
    }
  }
  return graph
}

/** Where the simulator's distance-vector routes disagree with Dijkstra on `graph`. */
function disagreements(sim: Simulator, graph: Graph, label: string): string[] {
  const problems: string[] = []
  for (const source of graph.nodes()) {
    const { dist } = dijkstra(graph, source)
    const nextHops = buildForwardingTable(graph, source)
    for (const destination of graph.nodes()) {
      if (destination === source) continue
      const shortest = dist.get(destination) as number
      const hop = sim.nextHop(source, destination)
      if (shortest >= DV_INFINITY) {
        if (hop !== undefined)
          problems.push(`${label} ${source}->${destination}: should be unreachable`)
        continue
      }
      const cost = costTo(sim, source, destination)
      if (hop !== nextHops.get(destination)) {
        problems.push(
          `${label} ${source}->${destination}: next hop ${hop}, Dijkstra ${nextHops.get(destination)}`,
        )
      } else if (cost === undefined || Math.abs(cost - shortest) > 1e-9) {
        problems.push(`${label} ${source}->${destination}: cost ${cost}, Dijkstra ${shortest}`)
      }
    }
  }
  return problems
}

describe('distance-vector vs Dijkstra', () => {
  it('converges to the same next hops on 50 random graphs, before and after a link is cut', () => {
    const rng = new Rng(1616)
    const problems: string[] = []
    for (let trial = 0; trial < 50; trial++) {
      const graph = randomNetwork(rng, rng.randomInt(4, 14))
      const sim = new Simulator(graph, { ...DV, splitHorizon: rng.uniform() < 0.5 })
      sim.runUntil(10_000)
      problems.push(...disagreements(sim, graph, `trial ${trial} start`))

      const upLinks = graph.edges().filter((edge) => edge.up)
      if (upLinks.length === 0) continue
      const cut = rng.pick(upLinks)
      sim.schedule(sim.now, { type: 'LINK_DOWN', linkId: cut.id })
      sim.runUntil(sim.now + 30_000) // long enough even if it has to count to infinity
      const afterCut = graph.clone()
      afterCut.setEdgeUp(cut.id, false)
      problems.push(...disagreements(sim, afterCut, `trial ${trial} after cutting ${cut.id}`))
    }
    expect(problems).toEqual([])
  })
})

describe('count to infinity on A - B - C', () => {
  /**
   * Cuts B-C at 5 s, sends a packet A -> C every 5 ms for 100 ms, and records every cost to C.
   * TTL 6 runs out in about 15 ms of looping, before the count (about 28 ms) is over.
   */
  function cutAndWatch(options: Partial<SimConfig>) {
    const sim = new Simulator(countToInfinity().graph, { ...DV, defaultTtl: 6, ...options })
    sim.runUntil(5_000)
    const before = { A: costTo(sim, 'A', 'C'), B: costTo(sim, 'B', 'C') }
    sim.schedule(5_000, { type: 'LINK_DOWN', linkId: 'B-C' })
    const seen: Record<'A' | 'B', number[]> = { A: [], B: [] }
    for (let time = 5_000; time <= 8_000; time++) {
      sim.runUntil(time)
      if (time < 5_100 && time % 5 === 0) sim.sendPacket('A', 'C')
      for (const router of ['A', 'B'] as const) {
        const cost = costTo(sim, router, 'C') as number
        if (seen[router][seen[router].length - 1] !== cost) seen[router].push(cost)
      }
    }
    const [record] = sim.convergenceRecords()
    return { sim, before, seen, record }
  }

  it('counts up to 16 without split horizon, while packets loop until their TTL runs out', () => {
    const { sim, before, seen, record } = cutAndWatch({ splitHorizon: false, poisonReverse: false })
    expect(before).toEqual({ A: 2, B: 1 })
    // B falls back on A's stale "C costs 2" and they push each other up, one step per message.
    expect(seen.B.slice(1)).toEqual([3, 5, 7, 9, 11, 13, 15, 16])
    expect(seen.A.slice(1)).toEqual([4, 6, 8, 10, 12, 14, 16])
    const counted = new Set([...seen.A, ...seen.B])
    for (let cost = 3; cost <= DV_INFINITY; cost++) expect(counted.has(cost)).toBe(true)

    expect(sim.nextHop('A', 'C')).toBeUndefined()
    expect(sim.nextHop('B', 'C')).toBeUndefined()
    expect(sim.stats.counters.dropsByReason['ttl-expired']).toBeGreaterThan(0)
    // 50 ms to notice, then 14 counting steps of one 2 ms link delay each.
    expect(record.convergenceMs).toBe(50 + 14 * 2)
    expect(record.settledAt).not.toBeNull()
  })

  it('converges at once with poison reverse', () => {
    const { sim, seen, record } = cutAndWatch({ splitHorizon: false, poisonReverse: true })
    expect(seen.B.slice(1)).toEqual([16])
    expect(seen.A.slice(1)).toEqual([16])
    // B notices at 50 ms; its update reaches A one 2 ms delay later.
    expect(record.convergenceMs).toBe(50 + 2)
    expect(sim.stats.counters.dropsByReason['ttl-expired']).toBe(0)
  })

  it('converges at once with split horizon', () => {
    const { seen, record } = cutAndWatch({ splitHorizon: true, poisonReverse: false })
    expect(seen.B.slice(1)).toEqual([16])
    expect(seen.A.slice(1)).toEqual([16])
    expect(record.convergenceMs).toBe(52)
  })

  it('loses updates sent over the cut link before anyone notices', () => {
    const { sim } = cutAndWatch({ splitHorizon: true })
    expect(sim.control.lost).toBeGreaterThan(0)
    expect(sim.control.sent).toBe(
      sim.control.delivered + sim.control.lost + sim.snapshot().controlMessages.length,
    )
  })

  it('learns the route back when the link is restored', () => {
    const sim = new Simulator(countToInfinity().graph, { ...DV, splitHorizon: true })
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'B-C' })
    sim.schedule(3_000, { type: 'LINK_UP', linkId: 'B-C' })
    sim.runUntil(6_000)
    expect(costTo(sim, 'A', 'C')).toBe(2)
    expect(sim.nextHop('A', 'C')).toBe('B')
    const records = sim.convergenceRecords()
    expect(records.map((r) => r.up)).toEqual([false, true])
    expect(records.every((r) => r.settledAt !== null)).toBe(true)
  })
})

/**
 * A fake context with no simulator: messages wait in a list until pump() delivers them, all at
 * time 0, so a test can see exactly what each router advertises.
 */
function fakeNetwork(graph: Graph, options: { splitHorizon: boolean; poisonReverse: boolean }) {
  const protocol = new DistanceVectorRouting({ periodMs: 1_000, ...options })
  const pending: { from: NodeId; to: NodeId; message: ControlMessage }[] = []
  const sent: { from: NodeId; to: NodeId; entries: Map<NodeId, number> }[] = []
  const timers: RoutingTimer[] = []
  const ctx: RoutingContext = {
    now: () => 0,
    routerIds: graph.nodes(),
    knownGraph: graph,
    sendControl: (from, to, message) => {
      pending.push({ from, to, message })
      if (message.kind === 'distance-vector')
        sent.push({ from, to, entries: new Map(message.entries) })
    },
    controlInFlight: () => pending.length,
    setTimer: (_delay, timer) => timers.push(timer),
    routesChanged: () => {},
    settleChange: () => {},
    settleOpenChanges: () => {},
  }
  const pump = () => {
    while (pending.length > 0) {
      const { from, to, message } = pending.shift() as (typeof pending)[number]
      protocol.onControlMessage(ctx, to, from, message)
    }
  }
  protocol.onStart(ctx)
  pump()
  /** What `from` most recently told `to`. */
  const lastSent = (from: NodeId, to: NodeId) =>
    [...sent].reverse().find((s) => s.from === from && s.to === to)?.entries
  return { protocol, lastSent, timers }
}

describe('DistanceVectorRouting (unit)', () => {
  it('advertises routes learned from a neighbour back to it only when both options are off', () => {
    const graph = countToInfinity().graph
    const plain = fakeNetwork(graph, { splitHorizon: false, poisonReverse: false })
    const split = fakeNetwork(graph, { splitHorizon: true, poisonReverse: false })
    const poison = fakeNetwork(graph, { splitHorizon: false, poisonReverse: true })
    // A reaches C through B.
    expect(plain.lastSent('A', 'B')?.get('C')).toBe(2)
    expect(split.lastSent('A', 'B')?.has('C')).toBe(false)
    expect(poison.lastSent('A', 'B')?.get('C')).toBe(DV_INFINITY)
    // Routes not learned from B are advertised normally either way.
    expect(split.lastSent('A', 'B')?.get('A')).toBe(0)
  })

  it('builds the full table from neighbours only, and staggers periodic updates', () => {
    const graph = new Graph()
    for (const node of ['W', 'X', 'Y', 'Z']) graph.addNode(node)
    graph.addEdge('W', 'X', { cost: 1 })
    graph.addEdge('X', 'Y', { cost: 2 })
    graph.addEdge('Y', 'Z', { cost: 3 })
    graph.addEdge('W', 'Z', { cost: 10 })
    const { protocol, timers } = fakeNetwork(graph, { splitHorizon: true, poisonReverse: false })
    expect(protocol.routingTable('W')).toEqual([
      { destination: 'X', nextHop: 'X', cost: 1, reachable: true },
      { destination: 'Z', nextHop: 'X', cost: 6, reachable: true },
      { destination: 'Y', nextHop: 'X', cost: 3, reachable: true },
    ])
    expect(protocol.getNextHop('W', 'Z')).toBe('X')
    expect(protocol.getNextHop('W', 'W')).toBeUndefined()
    expect(timers.filter((t) => t.kind === 'dv-periodic').length).toBe(4)
  })

  it('caps costs at 16 and reports those destinations as unreachable', () => {
    const graph = new Graph()
    for (const node of ['P', 'Q', 'R']) graph.addNode(node)
    graph.addEdge('P', 'Q', { cost: 9 })
    graph.addEdge('Q', 'R', { cost: 9 })
    const { protocol } = fakeNetwork(graph, { splitHorizon: true, poisonReverse: false })
    expect(protocol.getNextHop('P', 'Q')).toBe('Q')
    expect(protocol.getNextHop('P', 'R')).toBeUndefined() // 18 is beyond RIP's horizon
    expect(protocol.routingTable('P').find((e) => e.destination === 'R')).toEqual({
      destination: 'R',
      nextHop: null,
      cost: DV_INFINITY,
      reachable: false,
    })
  })

  it('applies new split horizon and poison reverse settings to later updates', () => {
    const net = fakeNetwork(countToInfinity().graph, { splitHorizon: false, poisonReverse: false })
    net.protocol.setOptions({ poisonReverse: true })
    expect(net.protocol.getOptions()).toMatchObject({ splitHorizon: false, poisonReverse: true })
  })
})
