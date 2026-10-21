import type { EdgeId, NodeId } from '../ds/Graph.ts'

/**
 * The timeline of one link change (a failure or a repair) as the network reacts to it:
 * changed -> detected by the two routers next to the link (detectionDelayMs later) ->
 * routes change -> settled. Link-state settles when its recompute has run; distance-vector
 * settles once the network has gone a full update period without a route changing.
 */
export interface ConvergenceRecord {
  /** Index of this change, starting at 0. */
  id: number
  linkId: EdgeId
  /** false for a failure (LINK_DOWN), true for a repair (LINK_UP). */
  up: boolean
  changedAt: number
  detectedAt: number | null
  /** detectedAt - changedAt, or null until detected. */
  detectionMs: number | null
  /** When the protocol finished reacting; route changes after this are not credited here. */
  settledAt: number | null
  /** How many times a router's routes changed while this change was converging. */
  tablesChanged: number
  lastTableChangeAt: number | null
  /**
   * lastTableChangeAt - changedAt: how long the network took to settle on new routes.
   * null until a table changes, and stays null if no table needed to change.
   */
  convergenceMs: number | null
  /** Packets dropped, for any reason, between the change and settling. */
  packetsLost: number
  /** Routing control messages sent between the change and settling. */
  controlMessagesSent: number
}

/** Returns a fresh record for a change to `linkId` at `time`. Time: O(1). */
export function createConvergenceRecord(
  id: number,
  linkId: EdgeId,
  up: boolean,
  time: number,
): ConvergenceRecord {
  return {
    id,
    linkId,
    up,
    changedAt: time,
    detectedAt: null,
    detectionMs: null,
    settledAt: null,
    tablesChanged: 0,
    lastTableChangeAt: null,
    convergenceMs: null,
    packetsLost: 0,
    controlMessagesSent: 0,
  }
}

/** True if two forwarding tables send every destination to the same next hop. Time: O(V). */
export function sameForwardingTable(
  a: ReadonlyMap<NodeId, NodeId>,
  b: ReadonlyMap<NodeId, NodeId>,
): boolean {
  if (a.size !== b.size) return false
  for (const [destination, nextHop] of a) {
    if (b.get(destination) !== nextHop) return false
  }
  return true
}
