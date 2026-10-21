// Picks the routing protocol a simulation runs. Must not import React or touch the DOM.
import type { SimConfig } from '../sim/config.ts'
import { DistanceVectorRouting } from './distanceVector.ts'
import { LinkStateRouting } from './linkState.ts'
import type { RoutingProtocol } from './types.ts'

/** The protocol named in the config, with its settings. Time: O(1). */
export function createRoutingProtocol(config: SimConfig): RoutingProtocol {
  if (config.routing === 'distance-vector') {
    return new DistanceVectorRouting({
      periodMs: config.dvPeriodMs,
      splitHorizon: config.splitHorizon,
      poisonReverse: config.poisonReverse,
    })
  }
  return new LinkStateRouting()
}
