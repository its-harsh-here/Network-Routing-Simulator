import { useEffect, useRef, useState } from 'react'
import type { EdgeId, NodeId } from '../ds/Graph.ts'
import {
  addLink,
  addRouter,
  emptyTopology,
  moveRouter,
  removeLink,
  removeRouter,
  updateLink,
  type LinkFields,
} from '../topology/edit.ts'
import type { Point, Topology } from '../topology/presets.ts'
import { isTypingTarget } from './canvasInput.ts'
import type { Selection } from './hitTest.ts'
import { NEW_LINK } from './simulation.ts'

/**
 * The topology editor's state: the draft being edited (null when not editing), whether it has
 * changed, and what is selected. Every edit replaces the draft with a new topology from the pure
 * functions in topology/edit.ts. Edits that cannot be made (say, linking two routers that are
 * already linked) are reported through `onError`.
 * Each edit is O(V + E), as it copies the topology; moving a router is O(V).
 */
export function useTopologyEditor(onError: (message: string) => void) {
  const [draft, setDraft] = useState<Topology | null>(null)
  const [changed, setChanged] = useState(false)
  const [selection, setSelection] = useState<Selection>(null)
  const [linkMode, setLinkMode] = useState(false)

  const start = (design: Topology) => {
    setDraft(design)
    setChanged(false)
    setSelection(null)
  }

  const stop = () => {
    setDraft(null)
    setSelection(null)
  }

  /** Runs one edit on the draft; a thrown error becomes a message instead. */
  const edit = (change: (current: Topology) => { topology: Topology; select?: Selection }) => {
    if (draft === null) return
    try {
      const { topology, select } = change(draft)
      setDraft(topology)
      setChanged(true)
      if (select !== undefined) setSelection(select)
    } catch (error) {
      onError((error as Error).message)
    }
  }

  const actions = {
    addRouter: (point: Point) =>
      edit((current) => {
        const { topology, id } = addRouter(current, point)
        return { topology, select: { kind: 'router', id } }
      }),
    /** Called on every pointer move while dragging, so it updates from the latest draft. */
    moveRouter: (id: NodeId, point: Point) => {
      setDraft((current) => (current === null ? null : moveRouter(current, id, point)))
      setChanged(true)
    },
    addLink: (a: NodeId, b: NodeId) =>
      edit((current) => {
        const { topology, id } = addLink(current, a, b, NEW_LINK)
        return { topology, select: { kind: 'link', id } }
      }),
    updateLink: (id: EdgeId, fields: LinkFields) =>
      edit((current) => ({ topology: updateLink(current, id, fields) })),
    removeSelected: () => {
      const selected = selection
      if (selected === null) return
      edit((current) => ({
        topology:
          selected.kind === 'router'
            ? removeRouter(current, selected.id)
            : removeLink(current, selected.id),
        select: null,
      }))
    },
    rename: (name: string) => edit((current) => ({ topology: { ...current, name } })),
    clear: () => edit(() => ({ topology: emptyTopology(), select: null })),
    /** Replaces the whole draft, for a file loaded while editing. */
    replace: (topology: Topology) => edit(() => ({ topology, select: null })),
    select: setSelection,
    setLinkMode,
  }

  // Delete or Backspace removes the selection; Escape clears it. Only while editing, and not
  // while typing in the side form.
  const keys = useRef(actions)
  useEffect(() => {
    keys.current = actions
  })
  const editing = draft !== null
  useEffect(() => {
    if (!editing) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        keys.current.removeSelected()
      } else if (event.key === 'Escape') {
        keys.current.select(null)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [editing])

  return { draft, changed, selection, linkMode, start, stop, actions }
}
