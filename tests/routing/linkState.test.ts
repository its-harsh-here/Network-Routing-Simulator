import { describe, expect, it } from 'vitest'
import { buildForwardingTable, dijkstra } from '../../src/algo/dijkstra.ts'
import { findBridgesAndArticulationPoints } from '../../src/algo/tarjan.ts'
import { Graph } from '../../src/ds/Graph.ts'
import { createRoutingProtocol } from '../../src/routing/index.ts'
import { LinkStateRouting } from '../../src/routing/linkState.ts'
import { resolveConfig } from '../../src/sim/config.ts'
import { Rng } from '../../src/sim/rng.ts'
import { Simulator } from '../../src/sim/Simulator.ts'
import { grid, ring } from '../../src/topology/presets.ts'

const QUIET = { packetsPerSecond: 0, statsIntervalMs: 0 }

describe('LinkStateRouting', () => {
  it('is the default protocol, and the config picks distance-vector', () => {
    expect(createRoutingProtocol(resolveConfig()).name).toBe('link-state')
    expect(createRoutingProtocol(resolveConfig({ routing: 'distance-vector' })).name).toBe(
      'distance-vector',
    )
    expect(() => resolveConfig({ routing: 'ospf' as never })).toThrow(RangeError)
    expect(() => resolveConfig({ dvPeriodMs: 0 })).toThrow(RangeError)
  })

  it('has routes from the start, with Dijkstra costs', () => {
    const topology = grid(3, 3)
    const sim = new Simulator(topology.graph, QUIET)
    expect(sim.routing).toBeInstanceOf(LinkStateRouting)
    const { dist } = dijkstra(topology.graph, 'R0')
    const table = sim.routing.routingTable('R0')
    expect(table.length).toBe(8)
    for (const entry of table) {
      expect(entry.cost).toBe(dist.get(entry.destination))
      expect(entry.reachable).toBe(true)
    }
    expect(sim.nextHop('R0', 'R8')).toBeDefined()
  })

  it('floods an LSA from each end of a failed link and settles when flooding ends', () => {
    const sim = new Simulator(ring(5).graph, { ...QUIET, packetsPerSecond: 200 })
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    sim.runUntil(3_000)
    // Each LSA goes the long way round: 4 links of 2 ms after the 100 ms detection.
    expect(sim.control).toEqual({ sent: 8, delivered: 8, lost: 0 })
    expect(sim.convergenceRecords()[0].settledAt).toBe(1_000 + 100 + 4 * 2)
    const routing = sim.routing as LinkStateRouting
    for (const origin of ['R1', 'R2']) {
      expect([...routing.receiptsOf(origin, 1).values()]).toEqual([1, 1, 1, 1, 1])
    }
  })

  it('sends nothing while nothing changes', () => {
    const sim = new Simulator(ring(5).graph, { ...QUIET, packetsPerSecond: 200 })
    sim.runUntil(3_000)
    expect(sim.control).toEqual({ sent: 0, delivered: 0, lost: 0 })
  })
})

/** Random connected network: a random tree plus extra links, delays 1 to 5 ms, costs 1 to 3. */
function randomConnected(rng: Rng, n: number): Graph {
  const graph = new Graph()
  for (let i = 0; i < n; i++) graph.addNode(`r${i}`)
  const link = (a: number, b: number) =>
    graph.addEdge(`r${a}`, `r${b}`, { cost: rng.uniform(1, 3), delayMs: rng.randomInt(1, 5) })
  for (let i = 1; i < n; i++) link(i, rng.randomInt(0, i - 1))
  for (let a = 0; a < n; a++) {
    for (let b = a + 1; b < n; b++) {
      if (graph.edgeBetween(`r${a}`, `r${b}`) === undefined && rng.uniform() < 0.25) link(a, b)
    }
  }
  return graph
}

describe('link-state flooding', () => {
  it('every LSA reaches every router exactly once, on 30 random connected graphs', () => {
    const rng = new Rng(2121)
    const problems: string[] = []
    for (let trial = 0; trial < 30; trial++) {
      const graph = randomConnected(rng, rng.randomInt(4, 16))
      // Cut a link that is not a bridge, so the network stays connected and every router can hear.
      const bridges = new Set(findBridgesAndArticulationPoints(graph).bridges.map((e) => e.id))
      const candidates = graph.edges().filter((edge) => !bridges.has(edge.id))
      if (candidates.length === 0) continue
      const cut = rng.pick(candidates)
      const sim = new Simulator(graph, { ...QUIET, detectionDelayMs: 10 })
      sim.schedule(1_000, { type: 'LINK_DOWN', linkId: cut.id })
      sim.schedule(2_000, { type: 'LINK_UP', linkId: cut.id })
      sim.runUntil(3_000)

      const routing = sim.routing as LinkStateRouting
      // Seq 1 announces the failure and seq 2 the repair, from each end of the link.
      for (const origin of [cut.a, cut.b]) {
        for (const seq of [1, 2]) {
          const receipts = routing.receiptsOf(origin, seq)
          for (const router of graph.nodes()) {
            if (receipts.get(router) !== 1) {
              problems.push(
                `trial ${trial}: ${router} accepted ${origin}#${seq} ${receipts.get(router) ?? 0} times`,
              )
            }
          }
        }
      }
      // And the routes end up exactly Dijkstra's on the (repaired) network.
      for (const source of graph.nodes()) {
        const expected = buildForwardingTable(graph, source)
        for (const destination of graph.nodes()) {
          if (destination === source) continue
          if (sim.nextHop(source, destination) !== expected.get(destination)) {
            problems.push(`trial ${trial}: ${source}->${destination} differs from Dijkstra`)
          }
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('resynchronises the databases when a split network is joined again', () => {
    // Cutting R1-R2 and R4-R5 splits the ring into {R5, R0, R1} and {R2, R3, R4}. A failure on
    // one side (R0-R1) cannot be flooded to the other until R4-R5 comes back.
    const sim = new Simulator(ring(6).graph, { ...QUIET, detectionDelayMs: 10 })
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R4-R5' })
    sim.schedule(2_000, { type: 'LINK_DOWN', linkId: 'R0-R1' })
    sim.schedule(3_000, { type: 'LINK_UP', linkId: 'R4-R5' })
    const routing = sim.routing as LinkStateRouting
    sim.runUntil(2_500)
    expect(routing.heldSeq('R0', 'R0')).toBe(1) // R0's first new LSA announced the R0-R1 failure...
    expect(routing.heldSeq('R3', 'R0')).toBe(0) // ...but the other side still has R0's first one
    sim.runUntil(4_000)
    // Every router that is connected again now holds every other connected router's newest LSA.
    // (R1 has lost both its links: its newest LSA cannot reach anyone, which is fine.)
    const connected = ['R0', 'R2', 'R3', 'R4', 'R5']
    for (const router of connected) {
      for (const origin of connected) {
        expect(routing.heldSeq(router, origin)).toBe(routing.heldSeq(origin, origin))
      }
    }
    expect(sim.nextHop('R3', 'R0')).toBe('R4') // round through R4-R5, R0-R1 being down
    expect(sim.nextHop('R3', 'R1')).toBeUndefined() // R1 is cut off on both sides now
  })
})
