import { describe, expect, it } from 'vitest'
import { Graph } from '../../src/ds/Graph.ts'
import { QuietDetector } from '../../src/routing/quiet.ts'
import type { RoutingContext, RoutingTimer } from '../../src/routing/types.ts'

/** A context where the test sets the time and sees the timers and settle calls. */
function fakeContext() {
  const state = { now: 0, timers: [] as { delay: number; timer: RoutingTimer }[], settled: 0 }
  const ctx: RoutingContext = {
    now: () => state.now,
    routerIds: [],
    knownGraph: new Graph(),
    sendControl: () => {},
    controlInFlight: () => 0,
    setTimer: (delay, timer) => state.timers.push({ delay, timer }),
    routesChanged: () => {},
    settleChange: () => {},
    settleOpenChanges: () => state.settled++,
  }
  return { ctx, state }
}

describe('QuietDetector', () => {
  it('settles once a full quiet period passes, re-arming if there was activity meanwhile', () => {
    const { ctx, state } = fakeContext()
    const quiet = new QuietDetector(100)
    quiet.noteActivity(ctx) // at 0: one timer for 100 ms
    state.now = 60
    quiet.noteActivity(ctx) // no second timer while one is pending
    expect(state.timers.map((t) => t.delay)).toEqual([100])
    state.now = 100
    quiet.onTimer(ctx) // only 40 ms quiet so far: wait the other 60
    expect(state.timers.map((t) => t.delay)).toEqual([100, 60])
    expect(state.settled).toBe(0)
    state.now = 160
    quiet.onTimer(ctx)
    expect(state.settled).toBe(1)
  })

  it('does not re-arm for a leftover too small to move the clock (no endless loop)', () => {
    const { ctx, state } = fakeContext()
    const quiet = new QuietDetector(1_000 / 3)
    state.now = 5_000.1
    quiet.noteActivity(ctx)
    // Fire at a time a rounding error short of the deadline: 5000 + 1e-13 === 5000 in doubles.
    state.now = 5_000.1 + 1_000 / 3 - 1e-12
    quiet.onTimer(ctx)
    expect(state.settled).toBe(1)
    expect(state.timers.length).toBe(1) // no zero-length re-arm
  })
})
