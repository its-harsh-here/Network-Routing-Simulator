import { describe, expect, it } from 'vitest'
import type { Packet } from '../../src/sim/Packet.ts'
import { Router } from '../../src/sim/Router.ts'

function makePacket(dst: string, ttl: number, id = 1): Packet {
  return {
    id,
    src: 'S',
    dst,
    sizeBytes: 500,
    priority: 'bulk',
    createdAt: 0,
    ttl,
    hops: [],
    status: 'queued',
  }
}

function makeRouter(): Router {
  return new Router('R', ['X', 'Y'], 2)
}

describe('Router.route', () => {
  it('delivers a packet addressed to this router, even with TTL 0', () => {
    expect(makeRouter().route(makePacket('R', 0), undefined)).toEqual({ kind: 'deliver' })
  })

  it('drops a packet whose TTL has run out, even if there is a route', () => {
    expect(makeRouter().route(makePacket('D1', 0), 'X')).toEqual({
      kind: 'drop',
      reason: 'ttl-expired',
    })
  })

  it('drops a packet when the protocol has no route for it', () => {
    expect(makeRouter().route(makePacket('nowhere', 5), undefined)).toEqual({
      kind: 'drop',
      reason: 'no-route',
    })
  })

  it('forwards to the next hop the protocol chose', () => {
    const router = makeRouter()
    expect(router.route(makePacket('D1', 5), 'X')).toEqual({ kind: 'forward', nextHop: 'X' })
    expect(router.route(makePacket('D2', 1), 'Y')).toEqual({ kind: 'forward', nextHop: 'Y' })
  })

  it('does not change the packet', () => {
    const packet = makePacket('D1', 5)
    makeRouter().route(packet, 'X')
    expect(packet).toEqual(makePacket('D1', 5))
  })
})

describe('Router queues', () => {
  it('has one bounded first-in first-out queue per neighbour by default', () => {
    const router = makeRouter()
    const toX = router.queueTo('X')
    expect(toX.capacity).toBe(2)
    expect(toX.discipline).toBe('fifo')
    expect(router.queueTo('Y')).not.toBe(toX)
    expect(() => router.queueTo('Z')).toThrow('has no link')
  })

  it('reports queue lengths', () => {
    const router = makeRouter()
    router.queueTo('X').enqueue(makePacket('D1', 5, 1))
    router.queueTo('X').enqueue(makePacket('D1', 5, 2))
    router.queueTo('Y').enqueue(makePacket('D2', 5, 3))
    expect(router.queuedCount).toBe(3)
    expect(router.queueLengths()).toEqual({ X: 2, Y: 1 })
    expect(router.queueTo('X').enqueue(makePacket('D1', 5, 4)).accepted).toBe(false) // full
  })

  it('a router with no neighbours has no queues', () => {
    const router = new Router('alone', [], 4)
    expect(router.queuedCount).toBe(0)
    expect(router.queueLengths()).toEqual({})
  })
})
