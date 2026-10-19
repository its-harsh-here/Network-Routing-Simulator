import { Deque } from './Deque.ts'
import type { Comparator } from './types.ts'

interface Entry<T> {
  key: number
  value: T
}

/**
 * Sliding-window maximum helper. Entries are (key, value) pairs kept in a Deque so that values
 * strictly decrease from front to back, which makes the front the maximum of the window.
 *
 * Why it works: when a new value arrives, every entry at the back that is not greater than it
 * is removed. Those entries can never be the maximum again, because the new value is at least
 * as large and stays in the window longer than they do.
 *
 * Keys are positions in the stream, such as array indices or timestamps, and must never
 * decrease. "Greater" is defined by the comparator, so a reversed comparator gives a sliding
 * minimum.
 */
export class MonotonicDeque<T> {
  private readonly entries = new Deque<Entry<T>>()
  private readonly compare: Comparator<T>
  private lastKey = -Infinity

  /** Creates an empty window ordered by `compare` (the largest value is reported). Time: O(1). */
  constructor(compare: Comparator<T>) {
    this.compare = compare
  }

  /** Number of entries kept. This can be fewer than the values pushed. Time: O(1). */
  get size(): number {
    return this.entries.size
  }

  /**
   * Adds `value` at position `key`.
   * Time: O(1) amortised. One push may pop many entries, but each entry is pushed once and
   * popped at most once, so n pushes do O(n) work in total.
   * @throws RangeError if `key` is smaller than the previous key.
   */
  push(key: number, value: T): void {
    if (key < this.lastKey) {
      throw new RangeError(`MonotonicDeque keys must not decrease: ${key} after ${this.lastKey}`)
    }
    this.lastKey = key
    while (!this.entries.isEmpty()) {
      const back = this.entries.peekBack() as Entry<T>
      if (this.compare(back.value, value) > 0) break
      this.entries.popBack()
    }
    this.entries.pushBack({ key, value })
  }

  /**
   * Removes entries with a key below `minKey`, because they have left the window.
   * Time: O(1) amortised, for the same reason as push.
   */
  evictBefore(minKey: number): void {
    while (!this.entries.isEmpty()) {
      const front = this.entries.peekFront() as Entry<T>
      if (front.key >= minKey) break
      this.entries.popFront()
    }
  }

  /** Returns the largest value in the window, or undefined if empty. Time: O(1). */
  max(): T | undefined {
    return this.entries.peekFront()?.value
  }

  /** Removes all entries and forgets the last key. Time: O(1). */
  clear(): void {
    this.entries.clear()
    this.lastKey = -Infinity
  }
}

/**
 * Returns the maximum of every run of `windowSize` consecutive values, so
 * result[i] = max(values[i], ..., values[i + windowSize - 1]). Returns [] if there are fewer
 * values than `windowSize`.
 * Time: O(n). Each value is pushed onto the monotonic deque once and popped at most once.
 * @throws RangeError if windowSize is not a positive integer.
 */
export function slidingWindowMax(values: readonly number[], windowSize: number): number[] {
  if (!Number.isInteger(windowSize) || windowSize < 1) {
    throw new RangeError(`windowSize must be a positive integer, got ${windowSize}`)
  }
  const deque = new MonotonicDeque<number>((a, b) => a - b)
  const result: number[] = []
  for (let i = 0; i < values.length; i++) {
    deque.push(i, values[i])
    deque.evictBefore(i - windowSize + 1)
    if (i >= windowSize - 1) result.push(deque.max() as number)
  }
  return result
}
