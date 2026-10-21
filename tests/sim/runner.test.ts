import { describe, expect, it } from 'vitest'
import {
  buildTopology,
  DEFAULT_RUNNER_OPTIONS,
  formatReport,
  parseRunnerArgs,
  runScenario,
  type RunnerOptions,
} from '../../src/sim/runner.ts'
import { Simulator } from '../../src/sim/Simulator.ts'
import { PRESET_NAMES } from '../../src/topology/presets.ts'

describe('parseRunnerArgs', () => {
  it('uses the defaults when given nothing', () => {
    expect(parseRunnerArgs([])).toEqual(DEFAULT_RUNNER_OPTIONS)
  })

  it('reads every option', () => {
    const argv =
      '--preset mesh --size 12 --seconds 8 --seed 3 --rate 750 --fail-at 2.5 --fail-link R1-R2 --p 0.25'
    expect(parseRunnerArgs(argv.split(' '))).toEqual({
      ...DEFAULT_RUNNER_OPTIONS,
      preset: 'mesh',
      size: 12,
      seconds: 8,
      seed: 3,
      packetsPerSecond: 750,
      failAt: 2.5,
      failLink: 'R1-R2',
      meshP: 0.25,
    })
    expect(parseRunnerArgs(['--help']).help).toBe(true)
  })

  it('rejects bad arguments with a helpful message', () => {
    expect(() => parseRunnerArgs(['--colour', 'red'])).toThrow('unknown option --colour')
    expect(() => parseRunnerArgs(['--size'])).toThrow('--size needs a value')
    expect(() => parseRunnerArgs(['--preset', 'torus'])).toThrow('unknown preset')
    expect(() => parseRunnerArgs(['--size', '2.5'])).toThrow('--size must be an integer')
    expect(() => parseRunnerArgs(['--rate', 'fast'])).toThrow('--rate must be a number')
    expect(() => parseRunnerArgs(['--p', '2'])).toThrow('between 0 and 1')
    expect(() => parseRunnerArgs(['--seconds', '10', '--fail-at', '10'])).toThrow(
      'less than --seconds',
    )
  })
})

describe('runScenario', () => {
  const small: RunnerOptions = {
    ...DEFAULT_RUNNER_OPTIONS,
    size: 3,
    seconds: 4,
    packetsPerSecond: 500,
    failAt: 2,
  }

  it('reports before and after a failure of the busiest link', () => {
    const report = runScenario(small)
    const [before, after] = report.periods
    expect(report.periods.map((p) => p.label)).toEqual(['before', 'after'])
    expect(report.failedLink).not.toBeNull()
    expect(report.convergence).toMatchObject({ linkId: report.failedLink, detectionMs: 100 })
    // Link-state floods the news over 2 ms links: a few hops after the 100 ms detection.
    expect(report.convergence?.convergenceMs).toBeGreaterThan(100)
    expect(report.convergence?.convergenceMs).toBeLessThan(120)

    expect(before.generated + after.generated).toBe(report.totals.generated)
    expect(before.delivered + after.delivered).toBe(report.totals.delivered)
    expect(before.dropped).toBe(0)
    expect(before.deliveryRatio).toBe(1)
    expect(before.throughputPps).toBeGreaterThan(400) // about 500 packets/s offered
    expect(before.avgLatencyMs).toBeGreaterThan(0)
    expect(before.p95LatencyMs).toBeGreaterThanOrEqual(before.avgLatencyMs ?? Infinity)
    expect(after.busiestLink).not.toBeNull()
  })

  it('cuts the busiest link at the failure time', () => {
    // Seed 2 has a single busiest link, and it is not the first link in the list.
    const options = { ...small, seed: 2 }
    // Replay the run up to the failure and find the busiest link independently.
    const sim = new Simulator(buildTopology(options).graph, {
      seed: options.seed,
      packetsPerSecond: options.packetsPerSecond,
    })
    sim.runUntil((options.failAt as number) * 1000)
    const utilisation = new Map(
      sim.snapshot().links.map((l) => [l.id, Math.max(l.aToB.utilisation, l.bToA.utilisation)]),
    )
    const highest = Math.max(...utilisation.values())
    const report = runScenario(options)
    expect(highest).toBeGreaterThan(0)
    expect(report.failedLinkUtilisation).toBe(highest)
    expect(utilisation.get(report.failedLink as string)).toBe(highest)
    // Not just the first link by accident.
    expect([...utilisation.values()][0]).toBeLessThan(highest)
  })

  it('reports the whole run when nothing fails', () => {
    const report = runScenario({ ...small, failAt: null })
    expect(report.periods.map((p) => p.label)).toEqual(['whole run'])
    expect(report.failedLink).toBeNull()
    expect(report.convergence).toBeNull()
  })

  it('cuts the named link, and rejects one that does not exist', () => {
    expect(runScenario({ ...small, failLink: 'R0-R1' }).failedLink).toBe('R0-R1')
    expect(() => runScenario({ ...small, failLink: 'R0-R8' })).toThrow('unknown link')
  })

  it('runs every preset', () => {
    for (const preset of PRESET_NAMES) {
      const report = runScenario({ ...small, preset, size: 6, seconds: 1, failAt: 0.5 })
      expect(report.totals.generated).toBeGreaterThan(0)
    }
  })

  it('is deterministic for a given seed', () => {
    expect(formatReport(runScenario(small))).toBe(formatReport(runScenario(small)))
  })

  it('formats a readable summary', () => {
    const text = formatReport(runScenario(small))
    expect(text).toContain('topology   grid 3x3: 9 routers, 12 links')
    expect(text).toContain('before (0-2 s)')
    expect(text).toContain('after (2-4 s)')
    expect(text).toContain('link-failure')
    expect(text).toMatch(/convergence time \(last table change - failure\): \d+ ms/)
  })
})
