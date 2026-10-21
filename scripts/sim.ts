// Command-line entry for the headless runner, run by Node's built-in TypeScript support:
//   npm run sim -- --preset grid --size 5 --seconds 30 --seed 42 --fail-at 10
import { formatReport, parseRunnerArgs, runScenario, USAGE } from '../src/sim/runner.ts'

try {
  const options = parseRunnerArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
  } else {
    const started = performance.now()
    const report = runScenario(options)
    const wallSeconds = (performance.now() - started) / 1000
    console.log(formatReport(report))
    console.log(`\n  (${options.seconds} simulated seconds took ${wallSeconds.toFixed(2)} s)`)
  }
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}\n`)
  console.error(USAGE)
  process.exitCode = 1
}
