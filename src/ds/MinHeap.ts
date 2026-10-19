import type { Comparator } from './types.ts'

/**
 * Binary min-heap stored in an array. The item at index i has its children at 2i + 1 and
 * 2i + 2 and is never greater (per the comparator) than either child, so the smallest item
 * is always at index 0. The tree is complete, so its height is floor(log2 n).
 *
 * Items that compare equal come out in no guaranteed order: a heap is not stable.
 */
export class MinHeap<T> {
  private items: T[] = []
  private readonly compare: Comparator<T>

  /**
   * Creates an empty heap that pops the smallest item first according to `compare`.
   * Pass a reversed comparator, such as `(a, b) => b - a`, for a max-heap.
   * Time: O(1).
   */
  constructor(compare: Comparator<T>) {
    this.compare = compare
  }

  /** Number of items in the heap. Time: O(1). */
  get size(): number {
    return this.items.length
  }

  /** True if the heap has no items. Time: O(1). */
  isEmpty(): boolean {
    return this.items.length === 0
  }

  /**
   * Adds an item.
   * Time: O(log n). The item is appended as a leaf and swapped upward at most once per level.
   */
  push(item: T): void {
    this.items.push(item)
    this.siftUp(this.items.length - 1)
  }

  /**
   * Removes and returns the smallest item, or undefined if the heap is empty.
   * Time: O(log n). The last leaf moves to the root and is swapped downward at most once per
   * level.
   */
  pop(): T | undefined {
    if (this.items.length === 0) return undefined
    const smallest = this.items[0]
    const last = this.items.pop() as T
    if (this.items.length > 0) {
      this.items[0] = last
      this.siftDown(0)
    }
    return smallest
  }

  /** Returns the smallest item without removing it, or undefined if empty. Time: O(1). */
  peek(): T | undefined {
    return this.items[0]
  }

  /** Removes all items. Time: O(1): the old array is simply dropped. */
  clear(): void {
    this.items = []
  }

  /**
   * Returns a copy of the items in internal heap order: index 0 is the smallest, but the rest
   * are not sorted. Useful for drawing the heap as a tree. Time: O(n).
   */
  toArray(): T[] {
    return [...this.items]
  }

  /** Swaps the item at `index` with its parent until the parent is not greater. O(log n). */
  private siftUp(index: number): void {
    let child = index
    while (child > 0) {
      const parent = Math.floor((child - 1) / 2)
      if (this.compare(this.items[child], this.items[parent]) >= 0) return
      this.swap(child, parent)
      child = parent
    }
  }

  /** Swaps the item at `index` with its smaller child until neither child is smaller. O(log n). */
  private siftDown(index: number): void {
    const n = this.items.length
    let parent = index
    while (true) {
      const left = 2 * parent + 1
      const right = left + 1
      let smallest = parent
      if (left < n && this.compare(this.items[left], this.items[smallest]) < 0) smallest = left
      if (right < n && this.compare(this.items[right], this.items[smallest]) < 0) smallest = right
      if (smallest === parent) return
      this.swap(parent, smallest)
      parent = smallest
    }
  }

  private swap(i: number, j: number): void {
    const temp = this.items[i]
    this.items[i] = this.items[j]
    this.items[j] = temp
  }
}
