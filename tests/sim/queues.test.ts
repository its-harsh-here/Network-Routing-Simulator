import { describe, expect, it } from 'vitest'
import { Graph } from '../../src/ds/Graph.ts'
import type { Packet, Priority } from '../../src/sim/Packet.ts'
import { createQueue, FifoQueue, PRIORITY_RANK, PriorityPacketQueue } from '../../src/sim/queues.ts'
import { Rng } from '../../src/sim/rng.ts'
import { Simulator } from '../../src/sim/Simulator.ts'

let nextId = 1
function packet(priority: Priority): Packet {
  return {
    id: nextId++,
    src: 'S',
    dst: 'D',
    sizeBytes: 100,
    priority,
    createdAt: 0,
    ttl: 8,
    hops: [],
    status: 'queued',
  }
}

const drain = (queue: { dequeue(): Packet | undefined }) => {
  const out: Packet[] = []
  for (let p = queue.dequeue(); p !== undefined; p = queue.dequeue()) out.push(p)
  return out
}

describe('FifoQueue', () => {
  it('is first-in first-out and drops the arriving packet when full', () => {
    const queue = new FifoQueue(2)
    const [a, b, c] = [packet('bulk'), packet('video'), packet('video')]
    expect(queue.enqueue(a)).toEqual({ accepted: true, dropped: null })
    expect(queue.enqueue(b)).toEqual({ accepted: true, dropped: null })
    expect(queue.enqueue(c)).toEqual({ accepted: false, dropped: c }) // video or not
    expect(queue.toArray()).toEqual([a, b]) // a look, without taking anything out
    expect(queue.size).toBe(2)
    expect(drain(queue)).toEqual([a, b])
    expect(queue.toArray()).toEqual([])
  })
})

describe('PriorityPacketQueue', () => {
  it('serves video before web before bulk, first-in first-out within a class', () => {
    const queue = new PriorityPacketQueue(10)
    const arrivals = [
      packet('bulk'),
      packet('web'),
      packet('video'),
      packet('web'),
      packet('video'),
    ]
    for (const p of arrivals) queue.enqueue(p)
    const order = drain(queue).map((p) => `${p.priority}${p.id}`)
    const [b1, w1, v1, w2, v2] = arrivals.map((p) => `${p.priority}${p.id}`)
    expect(order).toEqual([v1, v2, w1, w2, b1])
  })

  it('when full, evicts the newest packet of the lowest class to make room', () => {
    const queue = new PriorityPacketQueue(3)
    const [bulkOld, bulkNew, web] = [packet('bulk'), packet('bulk'), packet('web')]
    for (const p of [bulkOld, bulkNew, web]) queue.enqueue(p)
    const video = packet('video')
    expect(queue.enqueue(video)).toEqual({ accepted: true, dropped: bulkNew })
    expect(drain(queue)).toEqual([video, web, bulkOld])
  })

  it('drops the arriving packet when nothing queued is lower', () => {
    const queue = new PriorityPacketQueue(2)
    queue.enqueue(packet('video'))
    queue.enqueue(packet('web'))
    const late = packet('web')
    expect(queue.enqueue(late)).toEqual({ accepted: false, dropped: late }) // same class: newest goes
    const bulk = packet('bulk')
    expect(queue.enqueue(bulk)).toEqual({ accepted: false, dropped: bulk })
    expect(queue.size).toBe(2)
  })

  it('rejects a capacity that is not a positive integer', () => {
    expect(() => new PriorityPacketQueue(0)).toThrow(RangeError)
    expect(createQueue('priority', 4).discipline).toBe('priority')
    expect(createQueue('fifo', 4).discipline).toBe('fifo')
  })

  it('matches a sorted-list reference under random arrivals and departures', () => {
    const rng = new Rng(9191)
    const capacity = 6
    const queue = new PriorityPacketQueue(capacity)
    // Reference: keep (rank, arrival) pairs in service order; evict from the end when full.
    const reference: { p: Packet; rank: number; seq: number }[] = []
    let seq = 0
    const problems: string[] = []
    for (let step = 0; step < 4_000; step++) {
      if (rng.uniform() < 0.6) {
        const p = packet(rng.pick(['video', 'web', 'bulk'] as const))
        const entry = { p, rank: PRIORITY_RANK[p.priority], seq: seq++ }
        let expected: { accepted: boolean; dropped: Packet | null }
        if (reference.length < capacity) {
          reference.push(entry)
          expected = { accepted: true, dropped: null }
        } else {
          const worst = reference[reference.length - 1]
          if (worst.rank <= entry.rank) {
            expected = { accepted: false, dropped: p }
          } else {
            reference.pop()
            reference.push(entry)
            expected = { accepted: true, dropped: worst.p }
          }
        }
        reference.sort((x, y) => x.rank - y.rank || x.seq - y.seq)
        const got = queue.enqueue(p)
        if (got.accepted !== expected.accepted || got.dropped !== expected.dropped) {
          problems.push(`step ${step}: enqueue differs`)
        }
      } else if (queue.dequeue() !== reference.shift()?.p) {
        problems.push(`step ${step}: dequeue differs`)
      }
      if (queue.size !== reference.length) problems.push(`step ${step}: size differs`)
      // toArray lists the packets in the order they will be sent, like the sorted reference.
      if (queue.toArray().some((p, i) => p !== reference[i].p)) {
        problems.push(`step ${step}: toArray differs`)
      }
    }
    expect(problems).toEqual([])
  })
})

describe('QoS under congestion', () => {
  /**
   * Two routers joined by a 1 Mbps link, loaded with about 1.6 Mbps each way of mixed traffic:
   * the queues stay full. The same seed gives the same arrivals whatever the queue discipline.
   */
  function congested(queueDiscipline: 'fifo' | 'priority') {
    const graph = new Graph()
    graph.addNode('A')
    graph.addNode('B')
    graph.addEdge('A', 'B', { id: 'ab', bandwidthBps: 1_000_000, delayMs: 5 })
    const sim = new Simulator(graph, {
      seed: 77,
      packetsPerSecond: 400,
      queueCapacity: 16,
      queueDiscipline,
      latencyWindowMs: 60_000, // one window covering the whole run
      statsIntervalMs: 0,
    })
    sim.runUntil(20_000)
    return sim
  }

  it('gives video a lower p95 latency with priority queues than with fifo, for the same seed', () => {
    const fifo = congested('fifo')
    const priority = congested('priority')
    expect(fifo.stats.counters.generated).toBe(priority.stats.counters.generated) // same arrivals
    const fifoVideo = fifo.stats.windowStats(fifo.now).byPriority.video
    const priorityVideo = priority.stats.windowStats(priority.now).byPriority.video
    expect(fifo.stats.counters.dropsByReason['queue-full']).toBeGreaterThan(0) // really congested
    expect(priorityVideo.p95LatencyMs as number).toBeLessThan(
      (fifoVideo.p95LatencyMs as number) / 2,
    )
    // The price is paid by bulk traffic, which now waits and is dropped more.
    expect(priority.stats.counters.droppedByPriority.bulk).toBeGreaterThan(
      fifo.stats.counters.droppedByPriority.bulk,
    )
    expect(priority.stats.counters.droppedByPriority.video).toBeLessThan(
      fifo.stats.counters.droppedByPriority.video,
    )
  })

  it('uses a per-link discipline when one is given', () => {
    const graph = new Graph()
    for (const node of ['A', 'B', 'C']) graph.addNode(node)
    graph.addEdge('A', 'B', { id: 'ab' })
    graph.addEdge('B', 'C', { id: 'bc' })
    const sim = new Simulator(graph, {
      packetsPerSecond: 0,
      queueDiscipline: 'fifo',
      linkQueueDiscipline: { bc: 'priority' },
    })
    expect(sim.routers.get('A')?.queueTo('B').discipline).toBe('fifo')
    expect(sim.routers.get('B')?.queueTo('C').discipline).toBe('priority')
    expect(sim.routers.get('C')?.queueTo('B').discipline).toBe('priority')
  })
})
