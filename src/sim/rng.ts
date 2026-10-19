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

  /** Returns the next float in [0, 1). Time: O(1). */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) | 0
    let t = this.state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /**
   * Returns an integer in [min, max], both ends included. Time: O(1).
   * @throws RangeError if min or max is not an integer, or min > max.
   */
  int(min: number, max: number): number {
    if (!Number.isInteger(min) || !Number.isInteger(max) || min > max) {
      throw new RangeError(`Rng.int needs integers with min <= max, got ${min}, ${max}`)
    }
    return min + Math.floor(this.next() * (max - min + 1))
  }
}
