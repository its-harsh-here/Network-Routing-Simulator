/** Anything the frame loop can drive: the Simulator, or a fake in tests. */
export interface Steppable {
  readonly now: number
  advanceUntil(time: number, maxEvents: number): boolean
}

export interface FrameResult {
  /** The simulated time this frame aimed for. */
  simTarget: number
  /** True if the engine ran out of time before reaching simTarget. */
  lagging: boolean
}

/**
 * Advances the simulation for one animation frame: the target is wallDeltaMs * speed
 * simulated milliseconds past where it is now. Events are processed in chunks of
 * `chunkEvents`, checking the wall clock between chunks, and the frame stops once `budgetMs`
 * of real time is used, so a busy simulation cannot freeze the page.
 *
 * If the budget runs out first, the frame reports lagging and the rest of the step is
 * abandoned: the next frame starts from wherever the engine got to. So wall time skips ahead
 * instead of building up a backlog the engine could never clear, and the simulation simply
 * runs slower than the requested speed.
 *
 * Time: at most about budgetMs of wall-clock time, plus one chunk.
 */
export function advanceFrame(
  sim: Steppable,
  wallDeltaMs: number,
  speed: number,
  budgetMs: number,
  wallNow: () => number,
  chunkEvents = 200,
): FrameResult {
  const simTarget = sim.now + Math.max(0, wallDeltaMs * speed)
  const deadline = wallNow() + budgetMs
  while (!sim.advanceUntil(simTarget, chunkEvents)) {
    if (wallNow() >= deadline) return { simTarget, lagging: true }
  }
  return { simTarget, lagging: false }
}
