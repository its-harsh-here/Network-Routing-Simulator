import { describe, expect, it } from 'vitest'
import type { Packet } from '../../src/sim/Packet.ts'
import { Rng } from '../../src/sim/rng.ts'
import { Simulator } from '../../src/sim/Simulator.ts'
import { grid, line } from '../../src/topology/presets.ts'

const QUIET = { packetsPerSecond: 0, statsIntervalMs: 0 }

describe('per-router counters', () => {
  it('count where each packet was created, forwarded, delivered and dropped', () => {
    const sim = new Simulator(line(3).graph, { ...QUIET, queueCapacity: 1 }) // R0 - R1 - R2
    // The first packet is sent at once, the second waits, and the third finds the queue full.
    const packets = [1, 2, 3].map(() => sim.sendPacket('R0', 'R2', { sizeBytes: 1_000 }))
    sim.runUntil(1_000)
    expect(packets.map((p) => p.status)).toEqual(['delivered', 'delivered', 'dropped'])
    const counters = Object.fromEntries(
      [...sim.routers].map(([id, router]) => [id, { ...router.counters }]),
    )
    expect(counters).toEqual({
      R0: { originated: 3, forwarded: 2, delivered: 0, dropped: 1 },
      R1: { originated: 0, forwarded: 2, delivered: 0, dropped: 0 },
      R2: { originated: 0, forwarded: 0, delivered: 2, dropped: 0 },
    })
  })

  it('blame the sending router when its link is cut', () => {
    const sim = new Simulator(line(2).graph, QUIET)
    sim.sendPacket('R0', 'R1', { sizeBytes: 10_000 }) // 8 ms to send at 10 Mbps
    sim.schedule(1, { type: 'LINK_DOWN', linkId: 'R0-R1' })
    sim.runUntil(10)
    expect(sim.routers.get('R0')?.counters).toMatchObject({ forwarded: 1, dropped: 1 })
    expect(sim.findPacket(1)).toBeUndefined() // gone from the network
  })

  it('add up to the network totals, and forwarded matches the hops of delivered packets', () => {
    const rng = new Rng(31)
    const topology = grid(4, 4)
    const sim = new Simulator(topology.graph, { ...QUIET, queueCapacity: 1_000 })
    const routers = topology.graph.nodes()
    const sent: Packet[] = []
    for (let time = 0; time < 2_000; time += 5) {
      sim.runUntil(time)
      const src = rng.pick(routers)
      const dst = rng.pick(routers.filter((r) => r !== src))
      sent.push(sim.sendPacket(src, dst))
      if (time === 500) {
        expect(sim.findPacket(sent[sent.length - 1].id)).toBe(sent[sent.length - 1]) // still live
      }
    }
    sim.runUntil(5_000)
    expect(sent.every((p) => p.status === 'delivered')).toBe(true) // no failures, big queues

    // Reference: a delivered packet was forwarded once by every router on its path but the last.
    const forwarded = new Map(routers.map((r) => [r, 0]))
    for (const packet of sent) {
      for (const router of packet.hops.slice(0, -1)) {
        forwarded.set(router, (forwarded.get(router) as number) + 1)
      }
    }
    const totals = { originated: 0, delivered: 0, dropped: 0 }
    for (const [id, router] of sim.routers) {
      expect(router.counters.forwarded).toBe(forwarded.get(id))
      totals.originated += router.counters.originated
      totals.delivered += router.counters.delivered
      totals.dropped += router.counters.dropped
    }
    const { generated, delivered, dropped } = sim.stats.counters
    expect(totals).toEqual({ originated: generated, delivered, dropped })
  })
})
