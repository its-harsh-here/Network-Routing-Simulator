// npm run bench [-- --only=dijkstra,simulator,convergence] [--quick] [--report-only]
// Runs the benchmarks, writes their results as CSV in bench/results, and regenerates
// docs/benchmarks.md and the SVG charts from those CSV files.
// --quick runs tiny versions into a temporary folder (a smoke test; the real results stay).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { benchConvergence, CONVERGENCE_SETTINGS } from './convergence.ts'
import { benchDijkstra, DIJKSTRA_RUNS, DIJKSTRA_SIZES } from './dijkstra.ts'
import { machineInfo, toCsv } from './lib.ts'
import { writeReport } from './report.ts'
import { benchSimulator, SIMULATOR_SETTINGS } from './simulator.ts'

const PARTS = ['dijkstra', 'simulator', 'convergence'] as const
type Part = (typeof PARTS)[number]

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const quick = args.includes('--quick')
const reportOnly = args.includes('--report-only')
const onlyArg = args.find((a) => a.startsWith('--only='))
const parts: Part[] = onlyArg ? (onlyArg.slice('--only='.length).split(',') as Part[]) : [...PARTS]
for (const part of parts) {
  if (!PARTS.includes(part)) {
    console.error(`unknown benchmark "${part}"; choose from ${PARTS.join(', ')}`)
    process.exit(1)
  }
}

const resultsDir = quick ? mkdtempSync(join(tmpdir(), 'bench-')) : join(root, 'bench', 'results')
const docsDir = quick ? resultsDir : join(root, 'docs')
mkdirSync(resultsDir, { recursive: true })
const write = (file: string, text: string) => writeFileSync(join(resultsDir, file), text)
const log = (line: string) => console.log(line)

if (!reportOnly) {
  write(
    'machine.json',
    JSON.stringify({ ...machineInfo(), date: new Date().toISOString().slice(0, 10) }, null, 2) +
      '\n',
  )
  if (parts.includes('dijkstra')) {
    console.log('Dijkstra, heap vs naive (median of runs):')
    const rows = quick
      ? benchDijkstra([100, 500], 2, 1, log)
      : benchDijkstra(DIJKSTRA_SIZES, DIJKSTRA_RUNS, 1, log)
    write('dijkstra.csv', toCsv(rows))
  }
  if (parts.includes('simulator')) {
    console.log('Simulator speed:')
    const settings = quick ? { ...SIMULATOR_SETTINGS, simMs: 1_000, runs: 1 } : SIMULATOR_SETTINGS
    write('simulator.csv', toCsv(benchSimulator(settings, log)))
  }
  if (parts.includes('convergence')) {
    console.log('Protocol convergence (averages over the failures):')
    const settings = quick
      ? { ...CONVERGENCE_SETTINGS, failures: 2, warmupMs: 3_000, watchMs: 5_000 }
      : CONVERGENCE_SETTINGS
    const { failures, summary } = benchConvergence(settings, log)
    write('convergence.csv', toCsv(summary))
    write('convergence-failures.csv', toCsv(failures))
  }
}

// The report names the command that measures, whichever run only rewrote the page.
writeReport(resultsDir, docsDir, quick ? 'npm run bench -- --quick' : 'npm run bench')
console.log(`Results in ${resultsDir}; report in ${join(docsDir, 'benchmarks.md')}`)
