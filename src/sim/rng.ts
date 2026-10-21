/**
 * Seeded pseudo-random number generator (the mulberry32 algorithm). The same seed always
 * gives the same sequence, which keeps simulations and randomized tests reproducible.
 * All randomness in the project comes from here, never from Math.random.
 */
export class Rng {
  private state: number

  /** Creates a generator from a seed (treated as a 32-bit integer). Time: O(1). */
  constructor(seed: number) {
    this.state = seed | 0
  }

  /**
   * Returns a float in [min, max), every value equally likely. With no arguments, [0, 1).
   * Time: O(1).
   * @throws RangeError if min > max or either is not finite.
   */
  uniform(min = 0, max = 1): number {
    if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) {
      throw new RangeError(`Rng.uniform needs finite min <= max, got ${min}, ${max}`)
    }
    return min + this.nextFloat() * (max - min)
  }

  /**
   * Returns an integer in [min, max], both ends included. Time: O(1).
   * @throws RangeError if min or max is not an integer, or min > max.
   */
  randomInt(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      throw new RangeError(`Rng.randomInt needs integers with min <= max, got ${min}, ${max}`)
    }
    return min + Math.floor(this.nextFloat() * (max - min + 1))
  }

  /**
   * Returns one of `items`, each equally likely. Time: O(1).
   * @throws RangeError if `items` is empty.
   */
  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Rng.pick needs at least one item')
    return items[this.randomInt(0, items.length - 1)]
  }

  /**
   * Returns an exponentially distributed value with the given rate, so the mean is 1 / rate.
   * This is the waiting time between events of a Poisson process with that rate.
   * Uses inverse transform sampling: if U is uniform in [0, 1), then -ln(1 - U) / rate is
   * exponential. (1 - U is in (0, 1], so the logarithm is always finite.)
   * Time: O(1).
   * @throws RangeError if rate is not a positive finite number.
   */
  exponential(rate: number): number {
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new RangeError(`Rng.exponential needs a positive rate, got ${rate}`)
    }
    return -Math.log(1 - this.nextFloat()) / rate
  }

  /** Advances the mulberry32 state and returns a float in [0, 1). O(1). */
  private nextFloat(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
