import type { RoutingContext } from './types.ts'

/**
 * Below this many milliseconds a remaining wait counts as zero. Floating-point rounding can
 * leave a wait so small that now + wait === now; re-arming a timer with it would fire again at
 * the same instant forever, and the simulation would never move on.
 */
const EPSILON_MS = 1e-3

/**
 * Tells a routing protocol when the network has gone quiet: no routing activity for quietMs.
 * Then every link change that is still open is settled. At most one timer is pending at a time:
 * when it fires early (there was activity since it was set) it re-arms for the rest of the wait.
 */
export class QuietDetector {
  private quietMs: number
  private lastActivityAt = 0
  private timerPending = false

  /** Time: O(1). */
  constructor(quietMs: number) {
    this.quietMs = quietMs
  }

  /** Changes how long the network must stay quiet. Time: O(1). */
  setQuietMs(quietMs: number): void {
    this.quietMs = quietMs
  }

  /** Records routing activity now, and makes sure a check is scheduled. Time: O(log n). */
  noteActivity(ctx: RoutingContext): void {
    this.lastActivityAt = ctx.now()
    if (this.timerPending) return
    this.timerPending = true
    ctx.setTimer(this.quietMs, { kind: 'quiet' })
  }

  /** Handles the 'quiet' timer: settles if quiet long enough, otherwise waits the rest. O(log n). */
  onTimer(ctx: RoutingContext): void {
    this.timerPending = false
    const remaining = this.lastActivityAt + this.quietMs - ctx.now()
    if (remaining < EPSILON_MS) {
      ctx.settleOpenChanges()
      return
    }
    this.timerPending = true
    ctx.setTimer(remaining, { kind: 'quiet' })
  }
}
