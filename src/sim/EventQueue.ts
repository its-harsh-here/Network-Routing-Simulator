import { MinHeap } from '../ds/MinHeap.ts'

/** An event together with when it happens. */
export interface ScheduledEvent<E> {
  readonly time: number
  /** Order in which the event was scheduled. Breaks ties between events at the same time. */
  readonly seq: number
  readonly event: E
}

/**
 * Future events ordered by (time, seq): earliest time first, and events at the same time in the
 * order they were scheduled. The heap alone is not stable, so the sequence number makes ties
 * deterministic and first-come first-served.
 */
export class EventQueue<E> {
  private readonly heap = new MinHeap<ScheduledEvent<E>>((x, y) => {
    if (x.time !== y.time) return x.time - y.time
    return x.seq - y.seq
  })
  private nextSeq = 0

  /** Number of events waiting. Time: O(1). */
  get size(): number {
    return this.heap.size
  }

  /**
   * Adds `event` to happen at `time`.
   * Time: O(log n), one heap push.
   * @throws RangeError if time is not a finite number.
   */
  schedule(time: number, event: E): void {
    if (!Number.isFinite(time)) throw new RangeError(`EventQueue: time must be finite, got ${time}`)
    this.heap.push({ time, seq: this.nextSeq++, event })
  }

  /** Removes and returns the earliest event, or undefined if empty. Time: O(log n), one heap pop. */
  next(): ScheduledEvent<E> | undefined {
    return this.heap.pop()
  }

  /** Time of the earliest event, or undefined if empty. Time: O(1). */
  peekTime(): number | undefined {
    return this.heap.peek()?.time
  }
}
