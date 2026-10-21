import { describe, expect, it } from 'vitest'
import { Simulator } from '../../src/sim/Simulator.ts'
import { grid } from '../../src/topology/presets.ts'
import { advanceFrame, type Steppable } from '../../src/ui/frameLoop.ts'

/** A fake engine where every event is 1 simulated ms apart. Counts the events it processes. */
class FakeEngine implements Steppable {
  now = 0
  processed = 0

  advanceUntil(time: number, maxEvents: number): boolean {
    const due = Math.floor(time) - Math.floor(this.now)
    if (due > maxEvents) {
      this.now += maxEvents
      this.processed += maxEvents
      return false
    }
    this.processed += due
    this.now = time
    return true
  }
}

/** A fake wall clock that moves `msPerCall` every time it is read. */
function fakeClock(msPerCall: number) {
  let time = 0
  return () => (time += msPerCall)
}

describe('advanceFrame', () => {
  it('reaches now + wallDelta * speed when there is time', () => {
    const engine = new FakeEngine()
    const result = advanceFrame(engine, 16, 2, 8, fakeClock(0.1), 10)
    expect(result).toEqual({ simTarget: 32, lagging: false })
    expect(engine.now).toBe(32)
  })

  it('stops at the budget, reports lagging, and does not carry a backlog', () => {
    const engine = new FakeEngine()
    // Each wall-clock read costs 1 ms, so an 8 ms budget allows only a few chunks of 10 events.
    const first = advanceFrame(engine, 16, 1_000, 8, fakeClock(1), 10)
    expect(first.lagging).toBe(true)
    expect(first.simTarget).toBe(16_000)
    expect(engine.now).toBeLessThan(16_000)
    expect(engine.processed).toBeLessThanOrEqual(100)

    // The next frame aims from where the engine actually is, not from the missed target.
    const reached = engine.now
    const second = advanceFrame(engine, 16, 1_000, 8, fakeClock(1), 10)
    expect(second.simTarget).toBe(reached + 16_000)
  })

  it('does nothing at speed 0 or for a negative time step', () => {
    const engine = new FakeEngine()
    engine.now = 50
    expect(advanceFrame(engine, 16, 0, 8, fakeClock(1))).toEqual({ simTarget: 50, lagging: false })
    expect(advanceFrame(engine, -5, 1, 8, fakeClock(1)).simTarget).toBe(50)
    expect(engine.processed).toBe(0)
  })

  it('gives exactly the same simulation as one runUntil, however the frames are chunked', () => {
    const config = { seed: 9, packetsPerSecond: 3_000 }
    const framed = new Simulator(grid(4, 4).graph, config)
    for (let frame = 0; frame < 120; frame++) {
      // Tiny chunks and a generous budget: many advanceUntil calls per frame, never lagging.
      expect(advanceFrame(framed, 16.7, 1, 1_000, fakeClock(0), 7).lagging).toBe(false)
    }
    const direct = new Simulator(grid(4, 4).graph, config)
    direct.runUntil(framed.now)
    expect(framed.stats.counters).toEqual(direct.stats.counters)
    expect(framed.snapshot()).toEqual(direct.snapshot())
  })
})
