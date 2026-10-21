import { describe, expect, it } from 'vitest'
import { busiestLinkNow } from '../../src/sim/runner.ts'
import { addLink, addRouter, emptyTopology } from '../../src/topology/edit.ts'
import { topologyToFile } from '../../src/topology/json.ts'
import {
  chartGroups,
  comparisonRows,
  DEFAULT_DURATION_MS,
  DEFAULT_FAIL_AT_MS,
  runComparison,
  type ComparisonScenario,
} from '../../src/ui/comparison.ts'
import {
  COUNT_TO_INFINITY_DELAY_MS,
  COUNT_TO_INFINITY_SETTINGS,
  createSimulation,
  DEFAULT_LIVE_SETTINGS,
  LIVE_SIM_CONFIG,
  NEW_LINK,
} from '../../src/ui/simulation.ts'

const GRID: ComparisonScenario = {
  settings: DEFAULT_LIVE_SETTINGS,
  failAtMs: DEFAULT_FAIL_AT_MS,
  durationMs: DEFAULT_DURATION_MS,
  failLink: null,
  network: null,
}

describe('runComparison', () => {
  const outcome = runComparison(GRID)
  const [ls, dv] = outcome.results

  it('runs link-state then distance-vector on the same link and the same traffic', () => {
    expect(outcome.results.map((r) => r.protocol)).toEqual(['link-state', 'distance-vector'])
    // The busiest link at the cut, in the link-state run, is the one cut in both runs.
    const { sim } = createSimulation(DEFAULT_LIVE_SETTINGS)
    sim.runUntil(DEFAULT_FAIL_AT_MS)
    expect(outcome.failedLink).toBe(busiestLinkNow(sim))
    // Routing never draws random numbers, so the generator made exactly the same packets.
    expect(ls.packetsSent).toBe(dv.packetsSent)
    expect(ls.packetsSent).toBeGreaterThan(1_000)
  })

  it('reports the convergence metrics of each run', () => {
    for (const result of outcome.results) {
      expect(result.detectionMs).toBe(LIVE_SIM_CONFIG.detectionDelayMs)
      expect(result.convergenceMs).toBeGreaterThanOrEqual(LIVE_SIM_CONFIG.detectionDelayMs)
      expect(result.settledMs).toBeGreaterThanOrEqual(result.convergenceMs as number)
      expect(result.settledMs).toBeLessThan(DEFAULT_DURATION_MS)
      expect(result.controlMessages).toBeGreaterThan(0)
      expect(result.deliveryRatio).toBeGreaterThan(0.9)
      expect(result.p95LatencyMs).toBeGreaterThanOrEqual(result.avgLatencyMs as number)
    }
    // A 5x5 grid is only 8 hops across, well inside distance-vector's limit of 15.
    expect(outcome.results.map((r) => r.missingRoutes)).toEqual([0, 0])
    // Link-state is quiet when nothing changes; distance-vector advertises every period.
    expect(ls.controlMessagesTotal).toBe(ls.controlMessages)
    expect(dv.controlMessagesTotal).toBeGreaterThan(5 * ls.controlMessagesTotal)
  })

  it('gives the same outcome for the same scenario', () => {
    expect(runComparison(GRID)).toEqual(outcome)
  })

  it('shows count-to-infinity: distance-vector needs 14 more updates than link-state', () => {
    const settings = {
      ...DEFAULT_LIVE_SETTINGS,
      ...COUNT_TO_INFINITY_SETTINGS,
      topology: { ...DEFAULT_LIVE_SETTINGS.topology, preset: 'count-to-infinity' as const },
    }
    const { results } = runComparison({ ...GRID, settings, failLink: 'B-C' })
    const detection = LIVE_SIM_CONFIG.detectionDelayMs
    // Link-state: B notices, and its LSA needs one 400 ms hop to reach A.
    expect(results[0].convergenceMs).toBe(detection + COUNT_TO_INFINITY_DELAY_MS)
    // Distance-vector without split horizon: A and B count up to 16 in 14 steps.
    expect(results[1].convergenceMs).toBe(detection + 14 * COUNT_TO_INFINITY_DELAY_MS)
  })

  it('counts the routes distance-vector cannot hold: destinations 16 or more hops away', () => {
    // Cutting R19-R0 turns a ring of 20 into the line R0 - R1 - ... - R19, 19 hops end to end.
    // Pairs 16 to 19 hops apart: 4 + 3 + 2 + 1 = 10 of them, each counted in both directions.
    const settings = {
      ...DEFAULT_LIVE_SETTINGS,
      packetsPerSecond: 5,
      topology: { ...DEFAULT_LIVE_SETTINGS.topology, preset: 'ring' as const, size: 20 },
    }
    const { results } = runComparison({ ...GRID, settings, failLink: 'R19-R0' })
    expect(results.map((r) => r.missingRoutes)).toEqual([0, 2 * 10])
  })

  it('runs on a custom network, sent to it in file form', () => {
    // A square R0-R1-R2-R3 built with the editor's functions.
    let topology = emptyTopology('square')
    for (const [x, y] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]) {
      topology = addRouter(topology, { x, y }).topology
    }
    for (const [a, b] of [
      ['R0', 'R1'],
      ['R1', 'R2'],
      ['R2', 'R3'],
      ['R3', 'R0'],
    ]) {
      topology = addLink(topology, a, b, NEW_LINK).topology
    }
    const outcome = runComparison({ ...GRID, network: topologyToFile(topology), failLink: 'R0-R1' })
    expect(outcome.topologyName).toBe('square')
    expect(outcome.failedLink).toBe('R0-R1')
    for (const result of outcome.results) {
      expect(result.convergenceMs).toBeGreaterThanOrEqual(LIVE_SIM_CONFIG.detectionDelayMs)
      expect(result.missingRoutes).toBe(0) // the square stays connected the long way round
    }
    expect(outcome.results[0].packetsSent).toBe(outcome.results[1].packetsSent)
    const broken = { ...topologyToFile(topology), links: 'none' as never }
    expect(() => runComparison({ ...GRID, network: broken })).toThrow('"links" must be a list.')
  })

  it('rejects a link that does not exist', () => {
    expect(() => runComparison({ ...GRID, failLink: 'nope' })).toThrow('unknown link "nope"')
  })
})

describe('comparison table and chart', () => {
  const outcome = runComparison({
    ...GRID,
    settings: {
      ...DEFAULT_LIVE_SETTINGS,
      topology: { ...GRID.settings.topology, rows: 3, cols: 3 },
    },
  })

  it('has one formatted cell per protocol and marks the lower value as best', () => {
    const rows = comparisonRows(outcome)
    expect(rows.every((row) => row.cells.length === 2)).toBe(true)
    const byLabel = new Map(rows.map((row) => [row.label, row]))
    expect(byLabel.get('Detection')).toMatchObject({ cells: ['1000 ms', '1000 ms'], best: null })
    const total = byLabel.get('Routing msgs (whole run)')
    expect(total?.cells).toEqual(outcome.results.map((r) => `${r.controlMessagesTotal}`))
    expect(total?.best).toBe(0) // link-state sends far fewer messages
  })

  it('scales each bar group to its largest value', () => {
    for (const group of chartGroups(outcome)) {
      expect(Math.max(...group.fractions)).toBeLessThanOrEqual(1)
      const max = Math.max(...group.values)
      group.values.forEach((v, i) =>
        expect(group.fractions[i]).toBeCloseTo(max > 0 ? v / max : 0, 12),
      )
    }
    const silent = { ...outcome, results: outcome.results.map((r) => ({ ...r, packetsLost: 0 })) }
    expect(chartGroups(silent)[1].fractions).toEqual([0, 0])
  })
})
