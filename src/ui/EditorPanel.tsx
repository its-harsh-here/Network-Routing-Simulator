import { useState } from 'react'
import type { Edge } from '../ds/Graph.ts'
import { countParts, linkFieldErrors, type LinkFields } from '../topology/edit.ts'
import type { Topology } from '../topology/presets.ts'
import type { Selection } from './hitTest.ts'
import { NEW_LINK } from './simulation.ts'
import TopologyFiles from './TopologyFiles.tsx'
import type { useTopologyEditor } from './useTopologyEditor.ts'

type EditorActions = ReturnType<typeof useTopologyEditor>['actions']

const BUTTON =
  'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'
const INPUT =
  'rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none'

/**
 * The side panel in edit mode: the selection, the network's name, files, and Done/Cancel.
 * Render: O(V + E α(V)) for countParts, one UnionFind pass.
 */
export default function EditorPanel(props: {
  draft: Topology
  changed: boolean
  selection: Selection
  actions: EditorActions
  onDone: () => void
  onCancel: () => void
}) {
  const { draft, selection, actions } = props
  const parts = countParts(draft)
  const routers = draft.graph.nodeCount
  const selectedLink = selection?.kind === 'link' ? draft.graph.getEdge(selection.id) : undefined
  const selectedRouter =
    selection?.kind === 'router' && draft.graph.hasNode(selection.id) ? selection.id : null

  return (
    <div className="space-y-4">
      <label className="block text-xs text-slate-400">
        Network name
        <input
          type="text"
          value={draft.name}
          onChange={(event) => actions.rename(event.target.value)}
          className={`${INPUT} mt-1 w-full`}
        />
      </label>

      <div className="text-xs text-slate-400">
        {routers} router{routers === 1 ? '' : 's'}, {draft.graph.edgeCount} link
        {draft.graph.edgeCount === 1 ? '' : 's'}
        {parts > 1 && (
          <p className="mt-1 text-amber-300">
            The network is in {parts} separate parts: packets between them will be dropped.
          </p>
        )}
        {routers === 1 && (
          <p className="mt-1 text-amber-300">Traffic needs at least two routers.</p>
        )}
      </div>

      <div className="rounded-md bg-slate-800/60 p-3 ring-1 ring-slate-700/60">
        {selectedLink !== undefined ? (
          <LinkForm
            key={selectedLink.id}
            edge={selectedLink}
            onChange={(fields) => actions.updateLink(selectedLink.id, fields)}
            onDelete={actions.removeSelected}
          />
        ) : selectedRouter !== null ? (
          <>
            <p className="text-sm font-semibold text-slate-100">Router {selectedRouter}</p>
            <p className="mt-1 text-xs text-slate-400">
              Linked to:{' '}
              {draft.graph
                .neighbors(selectedRouter)
                .map((n) => n.node)
                .join(', ') || 'nothing yet'}
            </p>
            <button type="button" onClick={actions.removeSelected} className={`${BUTTON} mt-2`}>
              Delete router
            </button>
          </>
        ) : (
          <p className="text-xs text-slate-400">
            Click a link to edit its cost, bandwidth and delay, or a router to see its links. New
            links get cost {NEW_LINK.cost}, {NEW_LINK.bandwidthBps / 1000} kbps and{' '}
            {NEW_LINK.delayMs} ms.
          </p>
        )}
      </div>

      <TopologyFiles current={() => draft} onLoad={actions.replace} />

      <div className="flex gap-2">
        <button type="button" onClick={actions.clear} className={BUTTON}>
          Clear all
        </button>
        <button type="button" onClick={props.onCancel} className={`${BUTTON} flex-1`}>
          Cancel
        </button>
        <button
          type="button"
          onClick={props.onDone}
          className="flex-1 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-500"
        >
          Done
        </button>
      </div>
      <p className="text-[11px] text-slate-500">
        {props.changed
          ? 'Done rebuilds the routers and routing tables for the new network and restarts the simulation, with every link up. Cancel throws the changes away.'
          : 'Nothing has changed yet: Done goes back to the running simulation.'}
      </p>
    </div>
  )
}

/**
 * Cost, bandwidth and delay of the selected link. The fields keep what is typed; the link
 * changes as soon as all three are valid.
 */
function LinkForm(props: {
  edge: Edge
  onChange: (fields: LinkFields) => void
  onDelete: () => void
}) {
  const { edge } = props
  const [text, setText] = useState({
    cost: String(edge.cost),
    kbps: String(edge.bandwidthBps / 1000),
    delay: String(edge.delayMs),
  })
  const toFields = (t: typeof text): LinkFields => ({
    cost: t.cost.trim() === '' ? NaN : Number(t.cost),
    bandwidthBps: t.kbps.trim() === '' ? NaN : Number(t.kbps) * 1000,
    delayMs: t.delay.trim() === '' ? NaN : Number(t.delay),
  })
  const errors = linkFieldErrors(toFields(text))

  const change = (key: keyof typeof text, value: string) => {
    const next = { ...text, [key]: value }
    setText(next)
    const fields = toFields(next)
    if (linkFieldErrors(fields).length === 0) props.onChange(fields)
  }
  const field = (key: keyof typeof text, label: string, step: string) => (
    <label className="text-xs text-slate-400">
      {label}
      <input
        type="number"
        value={text[key]}
        step={step}
        onChange={(event) => change(key, event.target.value)}
        className={`${INPUT} mt-1 w-full`}
      />
    </label>
  )

  return (
    <>
      <p className="text-sm font-semibold text-slate-100">
        Link {edge.id}{' '}
        <span className="font-normal text-slate-400">
          ({edge.a} – {edge.b})
        </span>
      </p>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {field('cost', 'Cost', 'any')}
        {field('kbps', 'Bandwidth (kbps)', 'any')}
        {field('delay', 'Delay (ms)', 'any')}
      </div>
      {errors.length > 0 && (
        <ul className="mt-2 space-y-0.5 text-xs text-red-300" role="alert">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
      <button type="button" onClick={props.onDelete} className={`${BUTTON} mt-2`}>
        Delete link
      </button>
    </>
  )
}
