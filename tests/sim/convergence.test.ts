import { describe, expect, it } from 'vitest'
import { Graph } from '../../src/ds/Graph.ts'
import type { SimConfig } from '../../src/sim/config.ts'
import { sameForwardingTable } from '../../src/sim/convergence.ts'
import type { Packet } from '../../src/sim/Packet.ts'
import { Simulator } from '../../src/sim/Simulator.ts'
import { line, ring } from '../../src/topology/presets.ts'

/**
 * Link-state (the default), only the traffic a test sends, no stats samples, and failures
 * noticed after 50 ms. Preset links have a 2 ms delay, so each flooding hop takes 2 ms.
 */
const CONFIG: Partial<SimConfig> = {
  packetsPerSecond: 0,
  statsIntervalMs: 0,
  detectionDelayMs: 50,
}

/** Sends one packet from src to dst every `everyMs` until `untilMs`, running the sim in between. */
function sendEvery(
  sim: Simulator,
  src: string,
  dst: string,
  everyMs: number,
  untilMs: number,
): Packet[] {
  const packets: Packet[] = []
  for (let time = sim.now; time <= untilMs; time += everyMs) {
    sim.runUntil(time)
    packets.push(sim.sendPacket(src, dst))
  }
  return packets
}

const createdIn = (packets: Packet[], from: number, to: number) =>
  packets.filter((p) => p.createdAt >= from && p.createdAt < to)

describe('link failure and convergence (link-state with flooding)', () => {
  it('cutting the only path drops packets', () => {
    const sim = new Simulator(line(3).graph, CONFIG) // R0 - R1 - R2
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    const packets = sendEvery(sim, 'R0', 'R2', 10, 3_000)
    sim.runUntil(4_000)

    // A packet takes about 5 ms, so everything sent well before the cut arrives.
    expect(createdIn(packets, 0, 990).every((p) => p.status === 'delivered')).toBe(true)
    // Nothing sent after the cut gets through.
    expect(createdIn(packets, 1_000, Infinity).every((p) => p.status === 'dropped')).toBe(true)
    // R1 notices at 1050 and drops what waited for the dead link; its LSA reaches R0 at 1052.
    const waiting = createdIn(packets, 1_000, 1_050)
    expect(waiting.every((p) => p.dropReason === 'no-route' && p.finishedAt === 1_050)).toBe(true)
    expect(waiting[0].hops).toEqual(['R0', 'R1'])
    // From then on R0 itself knows there is no route.
    const known = createdIn(packets, 1_060, Infinity)
    expect(known.every((p) => p.dropReason === 'no-route' && p.hops.length === 1)).toBe(true)

    const counters = sim.stats.counters
    expect(counters.inFlight).toBe(0)
    expect(counters.generated).toBe(counters.delivered + counters.dropped)
    expect(counters.dropsByReason['no-route']).toBe(createdIn(packets, 1_000, Infinity).length)
  })

  it('cutting one link of a ring reroutes traffic the other way and delivery recovers', () => {
    const sim = new Simulator(ring(6).graph, CONFIG) // R0 - R1 - R2 - R3 - R4 - R5 - R0
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    const packets = sendEvery(sim, 'R0', 'R2', 10, 3_000)
    sim.runUntil(4_000)

    const before = createdIn(packets, 0, 990)
    expect(before.every((p) => p.status === 'delivered')).toBe(true)
    expect(before[0].hops).toEqual(['R0', 'R1', 'R2'])

    // During convergence packets wait at R1, then turn back through R0 once R1 knows.
    const during = createdIn(packets, 1_000, 1_060)
    expect(during.every((p) => p.status === 'delivered')).toBe(true)
    expect(during[0].hops).toEqual(['R0', 'R1', 'R0', 'R5', 'R4', 'R3', 'R2'])

    // After convergence every packet goes the long way round, and all of them arrive.
    const after = createdIn(packets, 1_060, Infinity)
    const longWay = ['R0', 'R5', 'R4', 'R3', 'R2']
    expect(after.every((p) => p.status === 'delivered')).toBe(true)
    expect(after.every((p) => p.hops.join() === longWay.join())).toBe(true)
    // 4 hops instead of 2 doubles the latency: each hop is 600 * 8 / 10 Mbps + 2 ms = 2.48 ms.
    expect(before[0].finishedAt! - before[0].createdAt).toBeCloseTo(2 * 2.48, 9)
    expect(after[0].finishedAt! - after[0].createdAt).toBeCloseTo(4 * 2.48, 9)

    expect(sim.stats.counters.dropped).toBe(0)
  })

  it('measured convergence time is the detection delay plus the flooding time', () => {
    for (const detection of [50, 7, 0]) {
      const sim = new Simulator(ring(6).graph, {
        ...CONFIG,
        packetsPerSecond: 500, // background traffic must not change the timing
        detectionDelayMs: detection,
      })
      sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R1-R2' })
      if (detection > 0) {
        sim.runUntil(1_000 + detection - 0.001)
        expect(sim.nextHop('R1', 'R2')).toBe('R2') // not noticed yet: still the direct route
      }
      sim.runUntil(5_000)
      expect(sim.nextHop('R1', 'R2')).toBe('R0') // now the long way round

      const [record] = sim.convergenceRecords()
      // The LSAs from R1 and R2 need two 2 ms hops to reach the last routers whose routes change,
      // and five hops to cross the whole ring, which is when flooding is over.
      expect(record).toMatchObject({
        linkId: 'R1-R2',
        up: false,
        changedAt: 1_000,
        detectedAt: 1_000 + detection,
        detectionMs: detection,
        convergenceMs: detection + 2 * 2,
        settledAt: 1_000 + detection + 5 * 2,
      })
      expect(record.tablesChanged).toBeGreaterThan(0)
      expect(record.controlMessagesSent).toBe(10) // each of the two LSAs crosses 5 links
    }
  })

  it('a router keeps its old route until an LSA reaches it', () => {
    const sim = new Simulator(ring(6).graph, CONFIG)
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    sim.runUntil(1_051) // R1 noticed at 1050; its LSA is still on the way to R0
    expect(sim.nextHop('R1', 'R2')).toBe('R0')
    expect(sim.nextHop('R0', 'R2')).toBe('R1')
    sim.runUntil(1_052) // one 2 ms hop later
    expect(sim.nextHop('R0', 'R2')).toBe('R5')
  })

  it('measures convergence for a repair too, and restores the short route', () => {
    const sim = new Simulator(ring(6).graph, CONFIG)
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    sim.schedule(2_000, { type: 'LINK_UP', linkId: 'R1-R2' })
    sim.runUntil(3_000)
    // A link comes back only when both of its routers' LSAs say it is up, and the second one
    // needs one more hop to reach the far routers.
    expect(sim.convergenceRecords().map((r) => [r.up, r.convergenceMs])).toEqual([
      [false, 54],
      [true, 56],
    ])
    const packet = sim.sendPacket('R0', 'R2')
    sim.runUntil(4_000)
    expect(packet.hops).toEqual(['R0', 'R1', 'R2'])
  })

  it('reports no convergence time when no forwarding table needed to change', () => {
    // A-C costs 5, but A-B-C costs 2, so no router ever uses A-C. Links have the default 1 ms delay.
    const graph = new Graph()
    for (const node of ['A', 'B', 'C']) graph.addNode(node)
    graph.addEdge('A', 'B', { id: 'ab', cost: 1 })
    graph.addEdge('B', 'C', { id: 'bc', cost: 1 })
    graph.addEdge('A', 'C', { id: 'ac', cost: 5 })
    const sim = new Simulator(graph, CONFIG)
    sim.schedule(100, { type: 'LINK_DOWN', linkId: 'ac' })
    sim.runUntil(1_000)
    expect(sim.convergenceRecords()[0]).toMatchObject({
      settledAt: 152, // noticed at 150; both LSAs reach B, and are forwarded on, by 152
      tablesChanged: 0,
      lastTableChangeAt: null,
      convergenceMs: null,
      packetsLost: 0,
    })
  })

  it('routes only around failures that have been flooded to it', () => {
    // The second failure (at 1120) is noticed at 1170, so at 1150 nobody knows about it yet.
    const sim = new Simulator(ring(6).graph, CONFIG)
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    sim.schedule(1_120, { type: 'LINK_DOWN', linkId: 'R4-R5' })
    sim.runUntil(1_150)
    expect(sim.knownGraph.getEdge('R4-R5')?.up).toBe(true) // really down, but not noticed yet
    expect(sim.nextHop('R1', 'R2')).toBe('R0') // via R5-R4, still believed up
    sim.runUntil(2_000)
    const records = sim.convergenceRecords()
    expect(records.map((r) => r.linkId)).toEqual(['R1-R2', 'R4-R5'])
    expect(records.every((r) => r.convergenceMs !== null && r.settledAt !== null)).toBe(true)
    expect(sim.nextHop('R1', 'R2')).toBeUndefined() // the ring is now in two pieces
  })

  it('gives each overlapping failure its own record', () => {
    const sim = new Simulator(ring(6).graph, CONFIG)
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    sim.schedule(1_005, { type: 'LINK_DOWN', linkId: 'R4-R5' })
    sim.runUntil(2_000)
    // The first flood dies on R4-R5 (already cut, not yet noticed), so it settles at 1054,
    // before the second failure is noticed at 1055.
    expect(sim.convergenceRecords().map((r) => [r.linkId, r.convergenceMs, r.settledAt])).toEqual([
      ['R1-R2', 54, 1_054],
      ['R4-R5', 54, 1_059],
    ])
  })

  it('counts the packets lost while the network converges', () => {
    const sim = new Simulator(line(3).graph, { ...CONFIG, packetsPerSecond: 0 })
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    const packets = sendEvery(sim, 'R0', 'R2', 10, 1_200)
    sim.runUntil(2_000)
    const [record] = sim.convergenceRecords()
    // Settled at 1052, when R1's LSA reaches R0: the packets lost up to then are counted.
    const lostBeforeSettling = packets.filter(
      (p) => p.status === 'dropped' && (p.finishedAt as number) <= (record.settledAt as number),
    )
    expect(record.packetsLost).toBe(lostBeforeSettling.length)
    expect(record.packetsLost).toBeGreaterThan(0)
  })
})

describe('sameForwardingTable', () => {
  it('compares destinations and next hops, ignoring insertion order', () => {
    const table = new Map([
      ['A', 'X'],
      ['B', 'Y'],
    ])
    expect(
      sameForwardingTable(
        table,
        new Map([
          ['B', 'Y'],
          ['A', 'X'],
        ]),
      ),
    ).toBe(true)
    expect(sameForwardingTable(table, new Map([['A', 'X']]))).toBe(false)
    expect(
      sameForwardingTable(
        table,
        new Map([
          ['A', 'X'],
          ['B', 'Z'],
        ]),
      ),
    ).toBe(false)
    expect(sameForwardingTable(new Map(), new Map())).toBe(true)
  })
})
