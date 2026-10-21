// Web Worker that runs a protocol comparison off the main thread, so the live view keeps
// animating while the two headless simulations run. One scenario in, one reply out.
import { runComparison, type ComparisonReply, type ComparisonScenario } from './comparison.ts'

self.addEventListener('message', (event: MessageEvent<ComparisonScenario>) => {
  let reply: ComparisonReply
  try {
    reply = { ok: true, outcome: runComparison(event.data) }
  } catch (error) {
    reply = { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
  self.postMessage(reply)
})
