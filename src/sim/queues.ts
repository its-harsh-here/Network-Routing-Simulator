import { MinHeap } from '../ds/MinHeap.ts'
import { RingBuffer } from '../ds/RingBuffer.ts'
import type { Packet, Priority } from './Packet.ts'

/**
 * How an output queue orders and drops packets:
 * - 'fifo': first in, first out; a full queue drops the arriving packet (drop-tail).
 * - 'priority': video before web before bulk, first in first out within a class; a full queue
 *   drops its lowest-priority packet, which may be the arriving one.
 */
export type QueueDiscipline = 'fifo' | 'priority'
export const QUEUE_DISCIPLINES: readonly QueueDiscipline[] = ['fifo', 'priority']

/** Service order of the classes: lower is served first and dropped last. */
export const PRIORITY_RANK: Readonly<Record<Priority, number>> = { video: 0, web: 1, bulk: 2 }

/** The outcome of offering a packet to a queue. */
export interface EnqueueResult {
  /** True if the offered packet is now in the queue. */
  accepted: boolean
  /**
   * A packet thrown away to keep within capacity: the offered one if it was not accepted, or a
   * lower-priority one evicted to make room for it. Null if nothing was dropped.
   */
  dropped: Packet | null
}

/** A router's bounded output queue towards one neighbour. */
export interface PacketQueue {
  readonly discipline: QueueDiscipline
  readonly capacity: number
  readonly size: number
  isEmpty(): boolean
  enqueue(packet: Packet): EnqueueResult
  /** Removes and returns the next packet to send, or undefined if empty. */
  dequeue(): Packet | undefined
  /** The queued packets in the order they would be sent, without changing the queue. */
  toArray(): Packet[]
}

/** Drop-tail first-in first-out queue, stored in a RingBuffer. */
export class FifoQueue implements PacketQueue {
  readonly discipline = 'fifo'
  private readonly buffer: RingBuffer<Packet>

  /** Time: O(capacity). @throws RangeError if capacity is not a positive integer. */
  constructor(capacity: number) {
    this.buffer = new RingBuffer<Packet>(capacity, 'drop-tail')
  }

  /** Time: O(1). */
  get capacity(): number {
    return this.buffer.capacity
  }

  /** Time: O(1). */
  get size(): number {
    return this.buffer.size
  }

  /** Time: O(1). */
  isEmpty(): boolean {
    return this.buffer.isEmpty()
  }

  /** Adds the packet at the back, or drops it if the queue is full. Time: O(1). */
  enqueue(packet: Packet): EnqueueResult {
    const accepted = this.buffer.enqueue(packet)
    return { accepted, dropped: accepted ? null : packet }
  }

  /** Time: O(1). */
  dequeue(): Packet | undefined {
    return this.buffer.dequeue()
  }

  /** Time: O(n). The ring buffer iterates oldest first, which is the sending order. */
  toArray(): Packet[] {
    return [...this.buffer]
  }
}

interface Entry {
  packet: Packet
  rank: number
  /** Arrival order, so packets of the same class leave first-in first-out. */
  seq: number
}

/** Puts entry x before y if it has a higher-priority class, or the same class and arrived first. */
function servedFirst(x: Entry, y: Entry): number {
  if (x.rank !== y.rank) return x.rank - y.rank
  return x.seq - y.seq
}

/**
 * Strict-priority queue stored in a MinHeap keyed by (class rank, arrival number). The next
 * packet out is the oldest packet of the highest-priority class waiting.
 *
 * When the queue is full, the packet to drop is the "worst" of the queued packets plus the
 * arriving one: the lowest class, and the newest within it. The arriving packet is the newest of
 * all, so it is dropped if no queued packet has a lower class; otherwise the worst queued packet
 * is evicted to make room.
 */
export class PriorityPacketQueue implements PacketQueue {
  readonly discipline = 'priority'
  readonly capacity: number
  private readonly heap = new MinHeap<Entry>(servedFirst)
  private nextSeq = 0

  /** Time: O(1). @throws RangeError if capacity is not a positive integer. */
  constructor(capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`queue capacity must be a positive integer, got ${capacity}`)
    }
    this.capacity = capacity
  }

  /** Time: O(1). */
  get size(): number {
    return this.heap.size
  }

  /** Time: O(1). */
  isEmpty(): boolean {
    return this.heap.isEmpty()
  }

  /**
   * Adds the packet; if the queue was full, drops the lowest-priority packet (see the class
   * comment). Time: O(log n) when there is room; O(n) when full, to find the packet to drop.
   */
  enqueue(packet: Packet): EnqueueResult {
    const entry: Entry = { packet, rank: PRIORITY_RANK[packet.priority], seq: this.nextSeq++ }
    if (this.heap.size < this.capacity) {
      this.heap.push(entry)
      return { accepted: true, dropped: null }
    }
    let worst: Entry | undefined
    for (const queued of this.heap.toArray()) {
      if (worst === undefined || servedFirst(queued, worst) > 0) worst = queued
    }
    if (worst === undefined || worst.rank <= entry.rank) return { accepted: false, dropped: packet }
    this.heap.remove((queued) => queued === worst)
    this.heap.push(entry)
    return { accepted: true, dropped: worst.packet }
  }

  /** Time: O(log n). */
  dequeue(): Packet | undefined {
    return this.heap.pop()?.packet
  }

  /** Time: O(n log n): the heap's array is only partly ordered, so it is sorted. */
  toArray(): Packet[] {
    return this.heap
      .toArray()
      .sort(servedFirst)
      .map((entry) => entry.packet)
  }
}

/** A queue with the given discipline and capacity. Time: O(capacity) for fifo, O(1) for priority. */
export function createQueue(discipline: QueueDiscipline, capacity: number): PacketQueue {
  return discipline === 'priority' ? new PriorityPacketQueue(capacity) : new FifoQueue(capacity)
}
