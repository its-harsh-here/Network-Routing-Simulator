import { useState } from 'react'
import type { NodeId } from '../ds/Graph.ts'
import type { BroadcastStrategy } from '../routing/broadcast.ts'
import type { BroadcastDemo, NetworkAnalysis, OverlayToggles } from './analysis.ts'

const BUTTON =
  'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'

/** At most this many link or router names are listed; the rest are counted. */
const LIST_LIMIT = 6

function list(names: readonly string[]): string {
  if (names.length <= LIST_LIMIT) return names.join(', ')
  return `${names.slice(0, LIST_LIMIT).join(', ')} and ${names.length - LIST_LIMIT} more`
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`
}

/**
 * The overlay switches with what they show, and the broadcast demo.
 * Render: O(V) for the router menu; the lists of bridges and articulation points show at most LIST_LIMIT names.
 */
export default function AnalysisPanel(props: {
  analysis: NetworkAnalysis | null
  overlays: OverlayToggles
  onOverlaysChange: (overlays: OverlayToggles) => void
  routers: readonly NodeId[]
  /** The router the broadcast starts from unless another is chosen. */
  defaultSource: NodeId | null
  broadcast: BroadcastDemo | null
  paused: boolean
  onBroadcast: (source: NodeId, shown: BroadcastStrategy) => void
}) {
  const { analysis, overlays } = props
  const [chosen, setChosen] = useState<NodeId | null>(null)
  const source =
    chosen !== null && props.routers.includes(chosen) ? chosen : (props.defaultSource ?? '')

  const toggle = (key: keyof OverlayToggles, label: string, colour: string) => (
    <label className="flex items-center gap-2 text-sm text-slate-200">
      <input
        type="checkbox"
        checked={overlays[key]}
        onChange={(event) => props.onOverlaysChange({ ...overlays, [key]: event.target.checked })}
        className="h-4 w-4 accent-sky-500"
      />
      <span className={`inline-block h-1.5 w-4 rounded ${colour}`} />
      {label}
    </label>
  )

  return (
    <div className="space-y-3">
      <div>
        {toggle('mst', 'MST broadcast tree', 'bg-emerald-400/70')}
        {analysis !== null && (
          <p className="mt-1 ml-6 text-xs text-slate-400">
            Kruskal: {plural(analysis.mstLinks.length, 'link')}, total cost{' '}
            <span className="font-mono text-slate-200">{formatCost(analysis.mstCost)}</span>
            {analysis.parts > 1 &&
              `. The links that are up leave ${analysis.parts} separate parts, so this is a spanning forest.`}
          </p>
        )}
      </div>
      <div>
        {toggle('weakSpots', 'Bridges and articulation points', 'bg-red-500')}
        {analysis !== null && (
          <p className="mt-1 ml-6 text-xs text-slate-400">
            {analysis.bridges.length === 0 && analysis.articulationPoints.length === 0 ? (
              'Tarjan finds none: no single link or router failure splits the network.'
            ) : (
              <>
                Tarjan: {plural(analysis.bridges.length, 'bridge')}
                {analysis.bridges.length > 0 && ` (${list(analysis.bridges)})`} and{' '}
                {plural(analysis.articulationPoints.length, 'articulation point')}
                {analysis.articulationPoints.length > 0 &&
                  ` (${list(analysis.articulationPoints)})`}
                . <span className="text-red-300">A failure here splits the network.</span>
              </>
            )}
          </p>
        )}
      </div>

      <div className="border-t border-slate-800 pt-3">
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-400" htmlFor="broadcast-source">
            Broadcast from
          </label>
          <select
            id="broadcast-source"
            value={source}
            onChange={(event) => setChosen(event.target.value)}
            className="rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-slate-700"
          >
            {props.routers.map((router) => (
              <option key={router} value={router}>
                {router}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={source === ''}
            onClick={() => props.onBroadcast(source, 'tree')}
            className={`${BUTTON} flex-1`}
          >
            Send along MST
          </button>
        </div>
        {props.broadcast !== null && (
          <BroadcastResults
            demo={props.broadcast}
            paused={props.paused}
            onReplay={(shown) => props.onBroadcast(props.broadcast?.source as NodeId, shown)}
          />
        )}
      </div>
    </div>
  )
}

/** The MST broadcast next to flooding: copies sent, copies wasted, routers reached, time. */
function BroadcastResults(props: {
  demo: BroadcastDemo
  paused: boolean
  onReplay: (shown: BroadcastStrategy) => void
}) {
  const { tree, flood } = props.demo
  const rows: [string, string, string][] = [
    ['Messages sent', `${tree.messages.length}`, `${flood.messages.length}`],
    ['Wasted copies', `${tree.duplicates}`, `${flood.duplicates}`],
    ['Routers reached', `${tree.reached.size}`, `${flood.reached.size}`],
    ['All reached after', `${Math.round(tree.doneAt)} ms`, `${Math.round(flood.doneAt)} ms`],
  ]
  return (
    <>
      <table className="mt-2 w-full text-xs">
        <thead className="text-[11px] text-slate-400">
          <tr>
            <th className="py-0.5 text-left font-normal">From {props.demo.source}</th>
            <th className="px-1 text-right font-medium text-emerald-300">MST tree</th>
            <th className="px-1 text-right font-medium text-slate-200">Flooding</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, viaTree, viaFlood]) => (
            <tr key={label} className="border-t border-slate-800">
              <td className="py-1 text-slate-400">{label}</td>
              <td className="px-1 text-right font-mono text-slate-100 tabular-nums">{viaTree}</td>
              <td className="px-1 text-right font-mono text-slate-100 tabular-nums">{viaFlood}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[11px] text-slate-500">
        Flooding passes the message to every neighbour but the sender, once per router (later copies
        are dropped, as LSAs are): 2E − V + 1 messages. The tree needs only V − 1, but its paths can
        be slower than flooding's, which always finds the fastest one.
        {props.paused && ' Paused: press play to watch it on the map.'}
      </p>
      <div className="mt-2 flex gap-2">
        <button type="button" onClick={() => props.onReplay('tree')} className={`${BUTTON} flex-1`}>
          Replay on MST
        </button>
        <button
          type="button"
          onClick={() => props.onReplay('flood')}
          className={`${BUTTON} flex-1`}
        >
          Show flooding
        </button>
      </div>
    </>
  )
}

function formatCost(cost: number): string {
  return Number.isInteger(cost) ? String(cost) : cost.toFixed(1)
}
