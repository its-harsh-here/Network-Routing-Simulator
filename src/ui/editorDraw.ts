import type { NodeId } from '../ds/Graph.ts'
import type { Point, Topology } from '../topology/presets.ts'
import { drawRing, drawRouter, screenPositions, strokePoints } from './draw.ts'
import type { Hit, Selection } from './hitTest.ts'
import type { View } from './view.ts'

const LINK_COLOR = '#64748b'
const SELECTED_COLOR = '#38bdf8'
const ROUTER_FILL = '#cbd5e1'
const LINK_OK_COLOR = '#4ade80'
const LINK_NOT_YET_COLOR = '#94a3b8'
const FONT = 'ui-sans-serif, system-ui, sans-serif'

/** Everything the editor canvas draws in one frame. Sizes are in CSS pixels. */
export interface EditorScene {
  width: number
  height: number
  view: View
  topology: Topology
  selection: Selection
  hover: Hit
  /**
   * A link being drawn, from a router to the pointer. `target` is the router it would join if
   * released here (the line snaps to it), or null.
   */
  pendingLink: { from: NodeId; pointer: Point; target: NodeId | null } | null
}

/**
 * Draws the topology being edited: links with their costs, the selection, a link being drawn,
 * and the routers on top. Time: O(V + E).
 */
export function drawEditor(ctx: CanvasRenderingContext2D, scene: EditorScene): void {
  const { topology, selection, hover } = scene
  ctx.clearRect(0, 0, scene.width, scene.height)
  const screen = screenPositions(topology.positions, scene.view)

  ctx.font = `10px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  for (const edge of topology.graph.edges()) {
    const a = screen.get(edge.a) as Point
    const b = screen.get(edge.b) as Point
    const isSelected = selection?.kind === 'link' && selection.id === edge.id
    if (hover?.kind === 'link' && hover.id === edge.id) {
      strokePoints(ctx, [a, b], 9, 'rgba(255, 255, 255, 0.25)', [])
    }
    strokePoints(ctx, [a, b], isSelected ? 4 : 2, isSelected ? SELECTED_COLOR : LINK_COLOR, [])
    ctx.fillStyle = isSelected ? SELECTED_COLOR : '#94a3b8'
    ctx.fillText(`${edge.cost}`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 3)
  }

  const pending = scene.pendingLink
  if (pending !== null) {
    const end = pending.target === null ? pending.pointer : (screen.get(pending.target) as Point)
    const color = pending.target === null ? LINK_NOT_YET_COLOR : LINK_OK_COLOR
    strokePoints(ctx, [screen.get(pending.from) as Point, end], 3, color, [6, 4])
  }

  for (const [id, center] of screen) {
    const isSelected = selection?.kind === 'router' && selection.id === id
    const isTarget = pending?.target === id || pending?.from === id
    if (isSelected) drawRing(ctx, center, SELECTED_COLOR)
    else if (isTarget) drawRing(ctx, center, LINK_OK_COLOR)
    drawRouter(ctx, id, center, ROUTER_FILL, hover?.kind === 'router' && hover.id === id)
  }

  if (screen.size === 0) {
    ctx.fillStyle = '#94a3b8'
    ctx.font = `14px ${FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText('Click anywhere to add a router', scene.width / 2, scene.height / 2)
  }
}
