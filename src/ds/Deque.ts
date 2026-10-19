const INITIAL_CAPACITY = 8

/**
 * Double-ended queue stored in a growable circular array. `head` is the slot of the front item
 * and the items fill `size` consecutive slots from there, wrapping past the end of the array
 * back to slot 0. Pushing at the front moves `head` back one slot (wrapping to the end), so
 * neither end ever needs to shift items. When the array is full it doubles in size.
 *
 * The array never shrinks, so memory stays at the largest size reached until clear().
 */
export class Deque<T> implements Iterable<T> {
  private buffer: (T | undefined)[] = new Array<T | undefined>(INITIAL_CAPACITY).fill(undefined)
  private head = 0
  private count = 0

  /** Number of items in the deque. Time: O(1). */
  get size(): number {
    return this.count
  }

  /** True if the deque has no items. Time: O(1). */
  isEmpty(): boolean {
    return this.count === 0
  }

  /**
   * Adds an item at the back.
   * Time: O(1) amortised. Usually one slot write; when the array is full it doubles, an O(n)
   * copy. Because the size doubles, n pushes cause at most 8 + 16 + ... + n < 2n copies in
   * total, which averages out to O(1) per push.
   */
  pushBack(item: T): void {
    if (this.count === this.buffer.length) this.grow()
    this.buffer[this.slotIndex(this.count)] = item
    this.count++
  }

  /** Adds an item at the front. Time: O(1) amortised, for the same reason as pushBack. */
  pushFront(item: T): void {
    if (this.count === this.buffer.length) this.grow()
    this.head = (this.head - 1 + this.buffer.length) % this.buffer.length
    this.buffer[this.head] = item
    this.count++
  }

  /** Removes and returns the front item, or undefined if empty. Time: O(1). */
  popFront(): T | undefined {
    if (this.count === 0) return undefined
    const item = this.buffer[this.head]
    this.buffer[this.head] = undefined // drop the reference so it can be garbage-collected
    this.head = (this.head + 1) % this.buffer.length
    this.count--
    return item
  }

  /** Removes and returns the back item, or undefined if empty. Time: O(1). */
  popBack(): T | undefined {
    if (this.count === 0) return undefined
    const index = this.slotIndex(this.count - 1)
    const item = this.buffer[index]
    this.buffer[index] = undefined
    this.count--
    return item
  }

  /** Returns the front item without removing it, or undefined if empty. Time: O(1). */
  peekFront(): T | undefined {
    return this.count === 0 ? undefined : this.buffer[this.head]
  }

  /** Returns the back item without removing it, or undefined if empty. Time: O(1). */
  peekBack(): T | undefined {
    return this.count === 0 ? undefined : this.buffer[this.slotIndex(this.count - 1)]
  }

  /** Removes all items and shrinks back to the initial capacity. Time: O(1). */
  clear(): void {
    this.buffer = new Array<T | undefined>(INITIAL_CAPACITY).fill(undefined)
    this.head = 0
    this.count = 0
  }

  /** Iterates from front to back without removing anything. Time: O(1) per item. */
  *[Symbol.iterator](): Generator<T> {
    for (let i = 0; i < this.count; i++) {
      yield this.buffer[this.slotIndex(i)] as T
    }
  }

  /** Array slot of the item `offset` places behind the front. O(1). */
  private slotIndex(offset: number): number {
    return (this.head + offset) % this.buffer.length
  }

  /** Doubles the array, copying the items so the front lands in slot 0. O(n). */
  private grow(): void {
    const bigger = new Array<T | undefined>(this.buffer.length * 2).fill(undefined)
    for (let i = 0; i < this.count; i++) {
      bigger[i] = this.buffer[this.slotIndex(i)]
    }
    this.buffer = bigger
    this.head = 0
  }
}
