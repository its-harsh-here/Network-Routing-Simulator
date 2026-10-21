import { RingBuffer } from '../ds/RingBuffer.ts'

/** What a log entry is about, for the filter chips. */
export const LOG_KINDS = ['link', 'convergence', 'drops', 'counting'] as const
export type LogKind = (typeof LOG_KINDS)[number]

export interface LogEntry {
  /** Numbers entries in the order they were added, also after old ones are overwritten. */
  seq: number
  /** Simulated time, in ms. */
  time: number
  kind: LogKind
  text: string
}

/** How many entries the simulator keeps: the newest 200. */
export const EVENT_LOG_CAPACITY = 200

/**
 * The newest notable events, in a RingBuffer in overwrite mode: once full, each new entry
 * replaces the oldest, so memory stays fixed however long the simulation runs.
 */
export class EventLog {
  private readonly entries: RingBuffer<LogEntry>
  private nextSeq = 0

  /** Time: O(capacity). @throws RangeError if capacity is not a positive integer. */
  constructor(capacity = EVENT_LOG_CAPACITY) {
    this.entries = new RingBuffer<LogEntry>(capacity, 'overwrite')
  }

  /** Adds an entry, dropping the oldest if the log is full. Time: O(1). */
  add(time: number, kind: LogKind, text: string): void {
    this.entries.enqueue({ seq: this.nextSeq++, time, kind, text })
  }

  /** The kept entries, oldest first. Time: O(n). */
  toArray(): LogEntry[] {
    return [...this.entries]
  }

  /** Entries kept now. Time: O(1). */
  get size(): number {
    return this.entries.size
  }

  /** Entries ever added, including those overwritten since. Time: O(1). */
  get total(): number {
    return this.nextSeq
  }
}
