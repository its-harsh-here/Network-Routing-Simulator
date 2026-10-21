import type { Edge, EdgeId, NodeId } from '../ds/Graph.ts'
import type { Packet } from './Packet.ts'

/**
 * One direction of a link: a transmitter that sends one packet at a time, and a record of how
 * busy it has been. Utilisation is measured in windows that end at each stats sample.
 */
export class LinkDirection {
  readonly from: NodeId
  readonly to: NodeId
  /** The packet being transmitted, or undefined when idle. */
  sending: Packet | undefined = undefined
  /** Fraction of the last completed window spent transmitting, from 0 to 1. */
  utilisation = 0
  private sendingSince = 0
  private busyMsInWindow = 0
  private windowStart = 0

  /** Creates an idle direction. Time: O(1). */
  constructor(from: NodeId, to: NodeId) {
    this.from = from
    this.to = to
  }

  /** True while a packet is being transmitted. Time: O(1). */
  get busy(): boolean {
    return this.sending !== undefined
  }

  /**
   * Starts transmitting `packet` at time `now`. Time: O(1).
   * @throws Error if already busy.
   */
  startSending(packet: Packet, now: number): void {
    if (this.sending !== undefined) throw new Error(`link ${this.from}->${this.to} is already busy`)
    this.sending = packet
    this.sendingSince = now
  }

  /**
   * Stops transmitting at time `now` (finished or cut off) and returns the packet.
   * Time: O(1).
   * @throws Error if idle.
   */
  finishSending(now: number): Packet {
    const packet = this.sending
    if (packet === undefined) throw new Error(`link ${this.from}->${this.to} is not sending`)
    // Only the part of the transmission inside the current window counts towards it.
    this.busyMsInWindow += now - Math.max(this.sendingSince, this.windowStart)
    this.sending = undefined
    return packet
  }

  /**
   * Ends the current window at `now`: sets `utilisation` to the busy fraction of the window and
   * starts a new one. A transmission still in progress is split between the two windows.
   * Time: O(1).
   */
  closeWindow(now: number): void {
    let busyMs = this.busyMsInWindow
    if (this.sending !== undefined) busyMs += now - Math.max(this.sendingSince, this.windowStart)
    const windowMs = now - this.windowStart
    this.utilisation = windowMs > 0 ? busyMs / windowMs : 0
    this.busyMsInWindow = 0
    this.windowStart = now
  }
}

/**
 * A simulated link wrapping a Graph edge, with an independent transmitter in each direction
 * (full duplex). A packet of S bytes takes S * 8 / bandwidthBps seconds to transmit, then
 * delayMs more to reach the far end.
 */
export class Link {
  readonly id: EdgeId
  /** The edge's current state. The simulator replaces it when the link goes up or down. */
  edge: Edge
  readonly aToB: LinkDirection
  readonly bToA: LinkDirection

  /** Creates an idle link for `edge`. Time: O(1). */
  constructor(edge: Edge) {
    this.id = edge.id
    this.edge = edge
    this.aToB = new LinkDirection(edge.a, edge.b)
    this.bToA = new LinkDirection(edge.b, edge.a)
  }

  /** True unless the link is cut. Time: O(1). */
  get up(): boolean {
    return this.edge.up
  }

  /**
   * The direction that starts at `from`. Time: O(1).
   * @throws Error if `from` is not an end of this link.
   */
  direction(from: NodeId): LinkDirection {
    if (from === this.edge.a) return this.aToB
    if (from === this.edge.b) return this.bToA
    throw new Error(`link ${this.id} does not touch ${from}`)
  }

  /**
   * Milliseconds to put a packet of `sizeBytes` onto the wire: sizeBytes * 8 / bandwidthBps
   * seconds. Multiplying before dividing keeps whole-number results exact (1000 bytes at
   * 1 Mbps is exactly 8 ms). Time: O(1).
   */
  transmissionTimeMs(sizeBytes: number): number {
    return (sizeBytes * 8 * 1000) / this.edge.bandwidthBps
  }
}
