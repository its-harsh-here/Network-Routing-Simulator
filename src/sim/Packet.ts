import type { NodeId } from '../ds/Graph.ts'

/** Traffic class. For now it only sets the packet size; queue scheduling can use it later. */
export type Priority = 'video' | 'web' | 'bulk'
export const PRIORITIES: readonly Priority[] = ['video', 'web', 'bulk']

/**
 * Why a packet was dropped. 'link-failure' means the packet was on a link (being transmitted or
 * travelling along it) at the moment the link went down.
 */
export type DropReason = 'ttl-expired' | 'no-route' | 'queue-full' | 'link-failure'
export const DROP_REASONS: readonly DropReason[] = [
  'ttl-expired',
  'no-route',
  'queue-full',
  'link-failure',
]

/**
 * Where a packet is in its life:
 * - 'queued': waiting in a router's output queue
 * - 'transmitting': its bits are being put onto a link
 * - 'propagating': fully sent and travelling along the link to the far end
 * - 'delivered' or 'dropped': finished
 */
export type PacketStatus = 'queued' | 'transmitting' | 'propagating' | 'delivered' | 'dropped'

/** A packet. The simulator updates ttl, hops, status and the finish fields as it moves. */
export interface Packet {
  readonly id: number
  readonly src: NodeId
  readonly dst: NodeId
  readonly sizeBytes: number
  readonly priority: Priority
  /** Simulated time (ms) when the packet was created at `src`. */
  readonly createdAt: number
  /** How many more links the packet may cross. Each router that forwards it subtracts 1. */
  ttl: number
  /** Routers visited so far, starting with `src`. */
  readonly hops: NodeId[]
  status: PacketStatus
  /** Simulated time (ms) when the packet was delivered or dropped. */
  finishedAt?: number
  dropReason?: DropReason
}
