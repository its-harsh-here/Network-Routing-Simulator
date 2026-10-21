import { useEffect, useRef, useState } from 'react'
import type { ComparisonOutcome, ComparisonReply, ComparisonScenario } from './comparison.ts'

/** The latest comparison, and whether one is running now. */
export interface ComparisonState {
  running: boolean
  /** The last finished comparison; kept on screen while the next one runs. */
  outcome: ComparisonOutcome | null
  /** Real time the last comparison took, in milliseconds. */
  elapsedMs: number | null
  error: string | null
}

/**
 * Runs protocol comparisons in a Web Worker, so the live view keeps animating while the two
 * headless simulations run. Starting a new comparison stops one that is still running.
 * Starting a run is O(1) on this thread: the comparison itself runs in a Web Worker.
 */
export function useComparison() {
  const [state, setState] = useState<ComparisonState>({
    running: false,
    outcome: null,
    elapsedMs: null,
    error: null,
  })
  const worker = useRef<Worker | null>(null)

  const run = (scenario: ComparisonScenario) => {
    worker.current?.terminate()
    const next = new Worker(new URL('./comparison.worker.ts', import.meta.url), { type: 'module' })
    worker.current = next
    const startedAt = performance.now()
    setState((s) => ({ ...s, running: true, error: null }))

    const finish = (update: Partial<ComparisonState>) => {
      next.terminate()
      if (worker.current !== next) return // a newer run replaced this one
      worker.current = null
      setState((s) => ({ ...s, ...update, running: false }))
    }
    next.onmessage = (event: MessageEvent<ComparisonReply>) => {
      const reply = event.data
      const elapsedMs = performance.now() - startedAt
      finish(reply.ok ? { outcome: reply.outcome, elapsedMs } : { error: reply.error })
    }
    next.onerror = (event) => finish({ error: event.message || 'the comparison worker failed' })
    next.postMessage(scenario)
  }

  // Stop a running comparison when the panel goes away.
  useEffect(() => () => worker.current?.terminate(), [])

  return { state, run }
}
