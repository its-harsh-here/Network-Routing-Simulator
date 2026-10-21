import type { NodeId } from '../ds/Graph.ts'
import { PRIORITIES, type Priority } from './Packet.ts'
import type { Rng } from './rng.ts'

/**
 * Milliseconds until the next packet of a Poisson stream averaging `packetsPerSecond`.
 * In a Poisson process the gaps between events are exponential with the same rate; the rate is
 * divided by 1000 to convert it from per second to per millisecond.
 * Time: O(1).
 * @throws RangeError if packetsPerSecond is not positive.
 */
export function interArrivalMs(rng: Rng, packetsPerSecond: number): number {
  return rng.exponential(packetsPerSecond / 1000)
}

/**
 * Picks a random ordered pair of different routers, every pair equally likely.
 * Time: O(1).
 * @throws RangeError if there are fewer than two routers.
 */
export function randomPair(rng: Rng, routers: readonly NodeId[]): { src: NodeId; dst: NodeId } {
  const n = routers.length
  if (n < 2) throw new RangeError('randomPair needs at least two routers')
  const i = rng.randomInt(0, n - 1)
  // Choose among the other n - 1 routers: take an index in 0..n-2 and skip over i.
  let j = rng.randomInt(0, n - 2)
  if (j >= i) j++
  return { src: routers[i], dst: routers[j] }
}

/**
 * Picks a priority with probability proportional to its weight in `mix`. Draws a number in
 * [0, total weight) and walks through the priorities until the running total passes it.
 * Time: O(1), since there are three priorities.
 * @throws RangeError if no weight is positive.
 */
export function pickPriority(rng: Rng, mix: Readonly<Record<Priority, number>>): Priority {
  let total = 0
  for (const priority of PRIORITIES) total += mix[priority]
  if (!(total > 0)) throw new RangeError('pickPriority needs at least one positive weight')

  let remaining = rng.uniform(0, total)
  let chosen: Priority = PRIORITIES[0]
  for (const priority of PRIORITIES) {
    if (mix[priority] <= 0) continue
    chosen = priority
    remaining -= mix[priority]
    if (remaining < 0) break
  }
  // If rounding leaves `remaining` at exactly 0, `chosen` is the last priority with weight > 0.
  return chosen
}
