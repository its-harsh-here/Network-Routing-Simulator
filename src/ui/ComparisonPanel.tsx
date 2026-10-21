import { useState } from 'react'
import type { EdgeId } from '../ds/Graph.ts'
import type { TopologyFile } from '../topology/json.ts'
import { PROTOCOL_COLORS } from './colors.ts'
import {
  chartGroups,
  comparisonRows,
  DEFAULT_DURATION_MS,
  DEFAULT_FAIL_AT_MS,
  type ComparisonOutcome,
} from './comparison.ts'
import { PROTOCOL_LABELS, type LiveSettings } from './simulation.ts'
import { useComparison } from './useComparison.ts'

const BUSIEST = ''

/**
 * Runs the same failure, with the same seed and traffic, under link-state and distance-vector
 * in the background, and shows the results side by side in a table and a bar chart.
 * Render: O(E) for the link menu, plus O(rows) for the table and chart.
 */
export default function ComparisonPanel(props: {
  /** What is running now: its seed, traffic, distance-vector options and queues. */
  settings: LiveSettings
  /** The running network if it is a custom one, or null for the preset in settings. */
  network: TopologyFile | null
  links: readonly EdgeId[]
}) {
  const { state, run } = useComparison()
  const [choice, setChoice] = useState<EdgeId>(BUSIEST)
  // A link of an earlier topology falls back to the busiest one.
  const failLink = choice !== BUSIEST && props.links.includes(choice) ? choice : null

  const start = () =>
    run({
      settings: props.settings,
      failAtMs: DEFAULT_FAIL_AT_MS,
      durationMs: DEFAULT_DURATION_MS,
      failLink,
      network: props.network,
    })

  return (
    <>
      <p className="text-xs text-slate-400">
        Runs the current network twice in the background, once per protocol, with the same seed and
        traffic: it cuts a link at {DEFAULT_FAIL_AT_MS / 1000} s and watches for{' '}
        {DEFAULT_DURATION_MS / 1000} s more.
      </p>
      <div className="mt-2 flex gap-2">
        <select
          aria-label="Link to cut"
          value={failLink ?? BUSIEST}
          onChange={(event) => setChoice(event.target.value)}
          className="min-w-0 flex-1 rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none"
        >
          <option value={BUSIEST}>Busiest link</option>
          {props.links.map((link) => (
            <option key={link} value={link}>
              {link}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={start}
          disabled={state.running}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium whitespace-nowrap text-white hover:bg-sky-500 disabled:opacity-50"
        >
          {state.running ? 'Running…' : 'Run comparison'}
        </button>
      </div>
      {state.error !== null && <p className="mt-2 text-xs text-red-400">{state.error}</p>}
      {state.outcome !== null && (
        <div className={state.running ? 'opacity-50' : ''}>
          <p className="mt-3 text-xs text-slate-500">
            {state.outcome.topologyName}, seed {state.outcome.scenario.settings.seed}, cut{' '}
            <span className="text-slate-300">{state.outcome.failedLink}</span>
            {state.elapsedMs !== null && ` (took ${Math.round(state.elapsedMs)} ms)`}
          </p>
          <ComparisonTable outcome={state.outcome} />
          <ComparisonChart outcome={state.outcome} />
        </div>
      )}
    </>
  )
}

/** One row per metric, one column per protocol; the better value of each row is green. */
function ComparisonTable({ outcome }: { outcome: ComparisonOutcome }) {
  return (
    <table className="mt-2 w-full text-xs">
      <thead className="text-[11px] text-slate-400">
        <tr>
          <th className="py-0.5 text-left font-normal">Lower is better</th>
          {outcome.results.map((result) => (
            <th key={result.protocol} className="px-1 text-right font-medium">
              <span style={{ color: PROTOCOL_COLORS[result.protocol] }}>
                {PROTOCOL_LABELS[result.protocol]}
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {comparisonRows(outcome).map((row) => (
          <tr key={row.label} className="border-t border-slate-800">
            <td className="py-1 text-slate-400">{row.label}</td>
            {row.cells.map((cell, i) => (
              <td
                key={i}
                className={`px-1 text-right font-mono tabular-nums ${
                  row.best === i ? 'font-semibold text-emerald-300' : 'text-slate-200'
                }`}
              >
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Chart geometry, in SVG units: the chart scales to the panel's width. */
const CHART_WIDTH = 320
const BAR_START = 30
const BAR_MAX = 230
const BAR_HEIGHT = 11
const BAR_GAP = 4
const GROUP_LABEL = 14
const GROUP_GAP = 10

/** Horizontal bars: one group per metric, one bar per protocol, scaled within each group. */
function ComparisonChart({ outcome }: { outcome: ComparisonOutcome }) {
  const groups = chartGroups(outcome)
  const protocols = outcome.results.map((r) => r.protocol)
  const groupHeight = GROUP_LABEL + protocols.length * (BAR_HEIGHT + BAR_GAP) + GROUP_GAP
  return (
    <svg
      viewBox={`0 0 ${CHART_WIDTH} ${groups.length * groupHeight}`}
      className="mt-3 w-full"
      role="img"
      aria-label="Bar chart comparing the protocols"
    >
      {groups.map((group, g) => {
        const top = g * groupHeight
        return (
          <g key={group.label} transform={`translate(0 ${top})`}>
            <text x={0} y={10} className="fill-slate-400" fontSize={10}>
              {group.label}
            </text>
            {protocols.map((protocol, i) => {
              const y = GROUP_LABEL + i * (BAR_HEIGHT + BAR_GAP)
              const width = Math.max(1, group.fractions[i] * BAR_MAX)
              return (
                <g key={protocol}>
                  <text x={0} y={y + 9} className="fill-slate-500" fontSize={9}>
                    {protocol === 'link-state' ? 'LS' : 'DV'}
                  </text>
                  <rect
                    x={BAR_START}
                    y={y}
                    width={width}
                    height={BAR_HEIGHT}
                    rx={2}
                    fill={PROTOCOL_COLORS[protocol]}
                  />
                  <text x={BAR_START + width + 4} y={y + 9} className="fill-slate-200" fontSize={9}>
                    {group.values[i]}
                  </text>
                </g>
              )
            })}
          </g>
        )
      })}
    </svg>
  )
}
