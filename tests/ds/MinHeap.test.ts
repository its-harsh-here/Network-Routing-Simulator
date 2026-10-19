import { describe, expect, it } from 'vitest'
import { MinHeap } from '../../src/ds/MinHeap.ts'
import { Rng } from '../../src/sim/rng.ts'

const ascending = (a: number, b: number) => a - b

/** Pops every item, smallest first. */
function drain<T>(heap: MinHeap<T>): T[] {
  const out: T[] = []
  while (!heap.isEmpty()) out.push(heap.pop() as T)
  return out
}

/** Index of the first child that is smaller than its parent, or -1 if the heap order holds. */
function firstHeapViolation(items: number[]): number {
  for (let child = 1; child < items.length; child++) {
    if (items[Math.floor((child - 1) / 2)] > items[child]) return child
  }
  return -1
}

/** Reference implementation: removes and returns the minimum by scanning the array. */
function removeMin(values: number[]): number | undefined {
  if (values.length === 0) return undefined
  let minIndex = 0
  for (let i = 1; i < values.length; i++) {
    if (values[i] < values[minIndex]) minIndex = i
  }
  return values.splice(minIndex, 1)[0]
}

describe('MinHeap', () => {
  it('starts empty', () => {
    const heap = new MinHeap(ascending)
    expect(heap.size).toBe(0)
    expect(heap.isEmpty()).toBe(true)
    expect(heap.peek()).toBeUndefined()
    expect(heap.pop()).toBeUndefined()
    expect(heap.toArray()).toEqual([])
  })

  it('handles a single item', () => {
    const heap = new MinHeap(ascending)
    heap.push(42)
    expect(heap.size).toBe(1)
    expect(heap.isEmpty()).toBe(false)
    expect(heap.peek()).toBe(42)
    expect(heap.pop()).toBe(42)
    expect(heap.isEmpty()).toBe(true)
    expect(heap.pop()).toBeUndefined()
  })

  it('pops items in ascending order', () => {
    const heap = new MinHeap(ascending)
    for (const n of [5, 3, 8, 1, 9, 2]) heap.push(n)
    expect(heap.peek()).toBe(1)
    expect(heap.size).toBe(6)
    expect(drain(heap)).toEqual([1, 2, 3, 5, 8, 9])
  })

  it('keeps duplicates', () => {
    const heap = new MinHeap(ascending)
    for (const n of [3, 1, 3, 1, 2, 2]) heap.push(n)
    expect(drain(heap)).toEqual([1, 1, 2, 2, 3, 3])
  })

  it('handles already sorted, reverse sorted and negative input', () => {
    for (const input of [
      [1, 2, 3, 4, 5],
      [5, 4, 3, 2, 1],
      [-3, 0, -10, 7],
    ]) {
      const heap = new MinHeap(ascending)
      for (const n of input) heap.push(n)
      expect(drain(heap)).toEqual([...input].sort(ascending))
    }
  })

  it('uses the comparator, so it can be a max-heap or order objects', () => {
    const maxHeap = new MinHeap<number>((a, b) => b - a)
    for (const n of [4, 7, 1]) maxHeap.push(n)
    expect(drain(maxHeap)).toEqual([7, 4, 1])

    const tasks = new MinHeap<{ name: string; priority: number }>((a, b) => a.priority - b.priority)
    tasks.push({ name: 'low', priority: 5 })
    tasks.push({ name: 'high', priority: 1 })
    tasks.push({ name: 'mid', priority: 3 })
    expect(drain(tasks).map((task) => task.name)).toEqual(['high', 'mid', 'low'])
  })

  it('clear removes everything and the heap is still usable', () => {
    const heap = new MinHeap(ascending)
    for (const n of [3, 1, 2]) heap.push(n)
    heap.clear()
    expect(heap.size).toBe(0)
    expect(heap.pop()).toBeUndefined()
    heap.push(9)
    expect(heap.peek()).toBe(9)
  })

  it('toArray returns a copy in heap order', () => {
    const heap = new MinHeap(ascending)
    for (const n of [5, 3, 8, 1]) heap.push(n)
    const items = heap.toArray()
    expect(items[0]).toBe(1)
    expect([...items].sort(ascending)).toEqual([1, 3, 5, 8])
    expect(firstHeapViolation(items)).toBe(-1)

    items.length = 0
    expect(heap.size).toBe(4)
  })

  describe('randomized', () => {
    it('pops 10,000 random numbers in sorted order', () => {
      const rng = new Rng(12345)
      const heap = new MinHeap(ascending)
      const values: number[] = []
      for (let i = 0; i < 10_000; i++) {
        // A small range guarantees plenty of duplicates.
        const value = rng.int(-1000, 1000)
        values.push(value)
        heap.push(value)
      }
      expect(heap.size).toBe(10_000)
      expect(firstHeapViolation(heap.toArray())).toBe(-1)
      expect(drain(heap)).toEqual(values.sort(ascending))
    })

    it('matches a linear-scan reference under mixed pushes and pops', () => {
      const rng = new Rng(7)
      const heap = new MinHeap(ascending)
      const reference: number[] = []
      for (let step = 0; step < 5_000; step++) {
        if (rng.next() < 0.6) {
          const value = rng.int(0, 100)
          heap.push(value)
          reference.push(value)
        } else {
          expect(heap.pop()).toBe(removeMin(reference))
        }
        expect(heap.size).toBe(reference.length)
        expect(heap.peek()).toBe(reference.length === 0 ? undefined : Math.min(...reference))
      }
      expect(firstHeapViolation(heap.toArray())).toBe(-1)
    })
  })
})
