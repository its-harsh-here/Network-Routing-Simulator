import type { EdgeId, NodeId } from '../ds/Graph.ts'
import type { RoutingTimer } from '../routing/types.ts'

/**
 * Everything that can happen in the simulation. The `type` field tells the variants apart, so a
 * `switch (event.type)` lets TypeScript know exactly which fields each case has.
 */
export type SimEvent =
  /**
   * Poisson traffic: create one random packet and schedule the next GENERATE_PACKET. `chain`
   * identifies the traffic setting it belongs to, so events from an old setting can be ignored.
   */
  | { readonly type: 'GENERATE_PACKET'; readonly chain: number }
  /** A packet's last bit reaches `router` at the far end of a link. */
  | { readonly type: 'PACKET_ARRIVE'; readonly packetId: number; readonly router: NodeId }
  /** Link `linkId` finished putting packet `packetId` onto the wire in the direction from `from`. */
  | {
      readonly type: 'TX_COMPLETE'
      readonly linkId: EdgeId
      readonly from: NodeId
      readonly packetId: number
    }
  | { readonly type: 'LINK_DOWN'; readonly linkId: EdgeId }
  | { readonly type: 'LINK_UP'; readonly linkId: EdgeId }
  /** The two routers next to the link have noticed link change number `changeId`. */
  | { readonly type: 'LINK_CHANGE_DETECTED'; readonly changeId: number }
  /** A timer the routing protocol asked for has fired. */
  | { readonly type: 'ROUTING_TIMER'; readonly timer: RoutingTimer }
  /** Routing control message `messageId` reaches the far end of its link. */
  | { readonly type: 'CONTROL_ARRIVE'; readonly messageId: number }
  /** Record a stats sample and each link's utilisation, then schedule the next sample. */
  | { readonly type: 'STATS_SAMPLE' }
