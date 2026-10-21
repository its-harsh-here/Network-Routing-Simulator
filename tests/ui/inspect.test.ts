import { describe, expect, it } from 'vitest'
import { buildForwardingTable } from '../../src/algo/dijkstra.ts'
import { Graph } from '../../src/ds/Graph.ts'
import { Rng } from '../../src/sim/rng.ts'
import { Simulator } from '../../src/sim/Simulator.ts'
import { countToInfinity, line, mesh, ring } from '../../src/topology/presets.ts'
import { inspectPacket, inspectPath, inspectRouter } from '../../src/ui/inspect.ts'

const QUIET = { packetsPerSecond: 0, statsIntervalMs: 0 }

describe('inspectRouter', () => {
  it('lists each queue in sending order, with the counters', () => {
    const sim = new Simulator(line(3).graph, { ...QUIET, queueDiscipline: 'priority' })
    sim.sendPacket('R1', 'R2', { priority: 'bulk', sizeBytes: 5_000 }) // sent at once
    const waiting = [
      sim.sendPacket('R1', 'R2', { priority: 'bulk' }),
      sim.sendPacket('R1', 'R2', { priority: 'video' }),
    ]
    const inspection = inspectRouter(sim, 'R1')
    expect(inspection?.counters).toEqual({ originated: 3, forwarded: 1, delivered: 0, dropped: 0 })
    expect(inspection?.queues.map((q) => [q.neighbour, q.linkId, q.discipline])).toEqual([
      ['R0', 'R0-R1', 'priority'],
      ['R2', 'R1-R2', 'priority'],
    ])
    // Video jumps the queue.
    expect(inspection?.queues[1].packets.map((p) => p.id)).toEqual([waiting[1].id, waiting[0].id])
    expect(inspectRouter(sim, 'nope')).toBeNull()
  })
})

describe('inspectPacket', () => {
  it('follows a packet from queue to link to delivery', () => {
    const sim = new Simulator(line(3).graph, QUIET)
    sim.sendPacket('R0', 'R2', { sizeBytes: 5_000 }) // 4 ms on the R0-R1 link
    const packet = sim.sendPacket('R0', 'R2', { priority: 'video', sizeBytes: 600 })
    const at = (time: number) => {
      sim.runUntil(time)
      return inspectPacket(packet, sim, sim.snapshot())
    }
    expect(at(1)).toMatchObject({
      location: 'waiting at R0 for the link to R1',
      hops: ['R0'],
      hopCount: 0,
      ageMs: 1,
      priority: 'video',
    })
    expect(at(4.1).location).toBe('being sent on R0 → R1')
    expect(at(5).location).toBe('travelling on R0 → R1')
    const done = at(100)
    expect(done).toMatchObject({
      location: 'delivered to R2',
      hops: ['R0', 'R1', 'R2'],
      hopCount: 2,
    })
    expect(done.ageMs).toBe((packet.finishedAt as number) - packet.createdAt) // frozen once done
  })

  it('says where a packet was dropped and why', () => {
    const sim = new Simulator(line(3).graph, QUIET)
    sim.schedule(0, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    sim.runUntil(0)
    const packet = sim.sendPacket('R0', 'R2')
    sim.runUntil(1_000)
    expect(inspectPacket(packet, sim, sim.snapshot())).toMatchObject({
      location: 'dropped at R1 (no-route)',
      dropReason: 'no-route',
      status: 'dropped',
    })
  })
})

describe('inspectPath', () => {
  it('finds the shortest path and checks the routers forward along it', () => {
    const sim = new Simulator(ring(6).graph, QUIET)
    expect(inspectPath(sim, 'R0', 'R2')).toMatchObject({
      shortest: { path: ['R0', 'R1', 'R2'], cost: 2, hops: 2 },
      forwarding: { path: ['R0', 'R1', 'R2'], outcome: 'arrives', cost: 2 },
      agrees: true,
    })
    expect(inspectPath(sim, 'R0', 'R0')).toBeNull()
    expect(inspectPath(sim, 'R0', 'nope')).toBeNull()
  })

  it('shows the routers lagging behind a failure, then catching up', () => {
    const sim = new Simulator(ring(6).graph, { ...QUIET, detectionDelayMs: 100 })
    sim.schedule(10, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    sim.runUntil(50) // cut, but not noticed
    expect(inspectPath(sim, 'R0', 'R2')).toMatchObject({
      shortest: { path: ['R0', 'R5', 'R4', 'R3', 'R2'], cost: 4 },
      forwarding: { path: ['R0', 'R1', 'R2'], outcome: 'dead-link', cost: null },
      agrees: false,
    })
    sim.runUntil(1_000)
    expect(inspectPath(sim, 'R0', 'R2')).toMatchObject({
      forwarding: { path: ['R0', 'R5', 'R4', 'R3', 'R2'], outcome: 'arrives' },
      agrees: true,
    })
  })

  it('reports a routing loop and an unreachable destination', () => {
    // Count to infinity: after B-C is cut, A and B point at each other for a while.
    const sim = new Simulator(countToInfinity().graph, {
      ...QUIET,
      routing: 'distance-vector',
      splitHorizon: false,
      detectionDelayMs: 10,
    })
    sim.runUntil(5_000)
    sim.schedule(5_000, { type: 'LINK_DOWN', linkId: 'B-C' })
    sim.runUntil(5_020)
    const looping = inspectPath(sim, 'A', 'C')
    expect(looping?.forwarding.outcome).toBe('loop')
    expect(looping?.forwarding.path).toEqual(['A', 'B', 'A'])
    expect(looping?.shortest).toBeNull() // C is cut off
    sim.runUntil(60_000)
    expect(inspectPath(sim, 'A', 'C')?.forwarding.outcome).toBe('no-route')
  })

  it('agrees with Dijkstra forwarding tables on random networks', () => {
    const rng = new Rng(64)
    for (let trial = 0; trial < 20; trial++) {
      const topology = mesh(rng.randomInt(3, 15), 0.2, rng.randomInt(1, 1e6))
      const graph: Graph = topology.graph
      const sim = new Simulator(graph, QUIET)
      const nodes = graph.nodes()
      const from = rng.pick(nodes)
      const to = rng.pick(nodes.filter((n) => n !== from))
      const inspection = inspectPath(sim, from, to)
      expect(inspection?.agrees).toBe(true) // link-state routes are Dijkstra's from the start
      // Each step of the shortest path is the next hop Dijkstra's table gives at that router.
      const path = inspection?.shortest?.path as string[]
      for (let i = 0; i + 1 < path.length; i++) {
        const table = buildForwardingTable(graph, path[i])
        expect(table.get(to)).toBe(path[i + 1])
      }
    }
  })
})
