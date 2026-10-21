import { describe, expect, it } from 'vitest'
import { Graph } from '../../src/ds/Graph.ts'
import { Link, LinkDirection } from '../../src/sim/Link.ts'
import type { Packet } from '../../src/sim/Packet.ts'

function makePacket(id = 1): Packet {
  return {
    id,
    src: 'A',
    dst: 'B',
    sizeBytes: 1000,
    priority: 'web',
    createdAt: 0,
    ttl: 8,
    hops: [],
    status: 'queued',
  }
}

function makeLink(bandwidthBps: number): Link {
  const graph = new Graph()
  graph.addNode('A')
  graph.addNode('B')
  return new Link(graph.addEdge('A', 'B', { id: 'ab', bandwidthBps, delayMs: 5 }))
}

describe('Link', () => {
  it('computes transmission time as sizeBytes * 8 / bandwidthBps, in ms', () => {
    expect(makeLink(1_000_000).transmissionTimeMs(1000)).toBe(8)
    expect(makeLink(10_000_000).transmissionTimeMs(1500)).toBeCloseTo(1.2, 12)
    expect(makeLink(100_000).transmissionTimeMs(64)).toBeCloseTo(5.12, 12)
  })

  it('has one direction per end', () => {
    const link = makeLink(1_000_000)
    expect(link.direction('A')).toBe(link.aToB)
    expect(link.direction('B')).toBe(link.bToA)
    expect(link.aToB.to).toBe('B')
    expect(link.bToA.to).toBe('A')
    expect(() => link.direction('C')).toThrow('does not touch')
  })

  it('reports up/down from its edge', () => {
    const link = makeLink(1_000_000)
    expect(link.up).toBe(true)
    link.edge = { ...link.edge, up: false }
    expect(link.up).toBe(false)
  })
})

describe('LinkDirection', () => {
  it('is busy only while sending, and refuses two packets at once', () => {
    const direction = new LinkDirection('A', 'B')
    expect(direction.busy).toBe(false)
    const packet = makePacket()
    direction.startSending(packet, 0)
    expect(direction.busy).toBe(true)
    expect(direction.sending).toBe(packet)
    expect(() => direction.startSending(makePacket(2), 1)).toThrow('already busy')
    expect(direction.finishSending(8)).toBe(packet)
    expect(direction.busy).toBe(false)
    expect(() => direction.finishSending(9)).toThrow('not sending')
  })

  it('measures utilisation as the busy fraction of each window', () => {
    const direction = new LinkDirection('A', 'B')
    direction.startSending(makePacket(), 0)
    direction.finishSending(8)
    direction.closeWindow(100)
    expect(direction.utilisation).toBeCloseTo(0.08, 12)

    direction.closeWindow(200) // idle all window
    expect(direction.utilisation).toBe(0)
  })

  it('splits a transmission that spans two windows', () => {
    const direction = new LinkDirection('A', 'B')
    direction.startSending(makePacket(), 90)
    direction.closeWindow(100) // busy 90..100
    expect(direction.utilisation).toBeCloseTo(0.1, 12)
    direction.finishSending(110)
    direction.closeWindow(200) // busy 100..110
    expect(direction.utilisation).toBeCloseTo(0.1, 12)
  })

  it('counts a window of zero length as 0% used', () => {
    const direction = new LinkDirection('A', 'B')
    direction.closeWindow(0)
    expect(direction.utilisation).toBe(0)
  })
})
