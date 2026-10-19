/**
 * What enqueue does when the buffer is full:
 * - 'drop-tail': reject the new item, like a router queue dropping an arriving packet.
 * - 'overwrite': replace the oldest item, like a log that keeps only the latest entries.
 */
export type RingBufferMode = 'drop-tail' | 'overwrite'

/**
 * Fixed-capacity FIFO queue stored in a circular array. `head` is the slot of the oldest item
 * and the items fill `size` consecutive slots from there, wrapping past the end of the array
 * back to slot 0. Nothing ever shifts, so every operation is O(1).
 */
export class RingBuffer<T> implements Iterable<T> {
  readonly capacity: number
  readonly mode: RingBufferMode
  private slots: (T | undefined)[]
  private head = 0
  private count = 0

  /**
   * Creates an empty buffer that holds at most `capacity` items.
   * Time: O(capacity) to allocate the slots.
   * @throws RangeError if capacity is not a positive integer.
   */
  constructor(capacity: number, mode: RingBufferMode = 'drop-tail') {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError(`RingBuffer capacity must be a positive integer, got ${capacity}`)
    }
    this.capacity = capacity
    this.mode = mode
    this.slots = new Array<T | undefined>(capacity).fill(undefined)
  }

  /** Number of items in the buffer. Time: O(1). */
  get size(): number {
    return this.count
  }

  /** True if the buffer has no items. Time: O(1). */
  isEmpty(): boolean {
    return this.count === 0
  }

  /** True if the buffer holds `capacity` items. Time: O(1). */
  isFull(): boolean {
    return this.count === this.capacity
  }

  /**
   * Adds an item as the newest. If the buffer is full, 'drop-tail' mode rejects the item and
   * returns false; 'overwrite' mode discards the oldest item to make room and returns true.
   * Time: O(1): one slot write and an index update.
   */
  enqueue(item: T): boolean {
    if (this.isFull()) {
      if (this.mode === 'drop-tail') return false
      // The oldest slot becomes the newest: write over it and move head past it.
      this.slots[this.head] = item
      this.head = (this.head + 1) % this.capacity
      return true
    }
    this.slots[(this.head + this.count) % this.capacity] = item
    this.count++
    return true
  }

  /** Removes and returns the oldest item, or undefined if empty. Time: O(1). */
  dequeue(): T | undefined {
    if (this.count === 0) return undefined
    const item = this.slots[this.head]
    this.slots[this.head] = undefined // drop the reference so it can be garbage-collected
    this.head = (this.head + 1) % this.capacity
    this.count--
    return item
  }

  /** Returns the oldest item without removing it, or undefined if empty. Time: O(1). */
  peek(): T | undefined {
    return this.count === 0 ? undefined : this.slots[this.head]
  }

  /** Removes all items. Time: O(capacity) to clear every slot. */
  clear(): void {
    this.slots.fill(undefined)
    this.head = 0
    this.count = 0
  }

  /** Iterates from oldest to newest without removing anything. Time: O(1) per item. */
  *[Symbol.iterator](): Generator<T> {
    for (let i = 0; i < this.count; i++) {
      yield this.slots[(this.head + i) % this.capacity] as T
    }
  }
}
