import { useEffect, useRef, type PointerEvent } from 'react'
import type { NodeId } from '../ds/Graph.ts'
import type { Point, Topology } from '../topology/presets.ts'
import { CLICK_SLOP, fittedView, localPoint, screenGeometry, useWheelZoom } from './canvasInput.ts'
import { LINK_HOVER_TOLERANCE, ROUTER_RADIUS } from './draw.ts'
import { drawEditor, type EditorScene } from './editorDraw.ts'
import { hitTest, type Hit, type Selection } from './hitTest.ts'
import { panBy, toWorld, type View } from './view.ts'

interface Props {
  draft: Topology
  selection: Selection
  /** True if dragging from a router draws a link (Shift does the opposite). */
  linkMode: boolean
  onLinkModeChange: (linkMode: boolean) => void
  onAddRouter: (point: Point) => void
  onMoveRouter: (id: NodeId, point: Point) => void
  onAddLink: (a: NodeId, b: NodeId) => void
  onSelect: (selection: Selection) => void
}

/** A mouse button or finger that is down on the canvas, and what the press is doing. */
interface Press {
  start: Point
  last: Point
  moved: boolean
  downHit: Hit
  /** Dragging from a router draws a link instead of moving it. */
  linking: boolean
  /** From the pointer to the grabbed router's centre, in world units, so it does not jump. */
  grabOffset: Point
}

/**
 * The topology editor's canvas. Click empty space to add a router, drag a router to move it,
 * Shift+drag from one router to another (or turn on link mode) to link them, click to select,
 * drag empty space to pan and use the wheel to zoom. Edits go to the callbacks; the canvas
 * draws whatever draft it is given, every frame, from refs.
 * Render: O(1). Each frame draws in O(V + E), and each pointer event hit-tests in O(V + E).
 */
export default function EditorCanvas(props: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const propsRef = useRef(props)
  const sizeRef = useRef({ width: 0, height: 0 })
  const viewRef = useRef<View | null>(null)
  const fitScaleRef = useRef(1)
  const userMovedViewRef = useRef(false)
  const hoverRef = useRef<Hit>(null)
  const pressRef = useRef<Press | null>(null)
  const pendingRef = useRef<EditorScene['pendingLink']>(null)

  useEffect(() => {
    propsRef.current = props
  })
  useWheelZoom(canvasRef, viewRef, fitScaleRef, userMovedViewRef)

  // The drawing loop: cheap enough to run every frame, so edits show at once.
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!container || !canvas || !ctx) return
    const resizeObserver = new ResizeObserver(([entry]) => {
      sizeRef.current = { width: entry.contentRect.width, height: entry.contentRect.height }
    })
    resizeObserver.observe(container)
    let backing = { width: 0, height: 0, dpr: 0 }
    let frameId = 0
    const frame = () => {
      const { width, height } = sizeRef.current
      const dpr = window.devicePixelRatio || 1
      if (width !== backing.width || height !== backing.height || dpr !== backing.dpr) {
        backing = { width, height, dpr }
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
        if (!userMovedViewRef.current || viewRef.current === null) {
          viewRef.current = fittedView(propsRef.current.draft, width, height)
          fitScaleRef.current = viewRef.current.scale
        }
      }
      if (viewRef.current !== null && width > 0 && height > 0) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
        drawEditor(ctx, {
          width,
          height,
          view: viewRef.current,
          topology: propsRef.current.draft,
          selection: propsRef.current.selection,
          hover: hoverRef.current,
          pendingLink: pendingRef.current,
        })
      }
      frameId = requestAnimationFrame(frame)
    }
    frameId = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [])

  const fit = () => {
    const { width, height } = sizeRef.current
    viewRef.current = fittedView(propsRef.current.draft, width, height)
    fitScaleRef.current = viewRef.current.scale
    userMovedViewRef.current = false
  }

  const hitAt = (point: Point): Hit => {
    const view = viewRef.current
    if (view === null) return null
    const { routers, links } = screenGeometry(propsRef.current.draft, view)
    return hitTest(point, routers, links, ROUTER_RADIUS, LINK_HOVER_TOLERANCE)
  }

  /** The router under the pointer that a link from `from` could join, or null. */
  const linkTarget = (point: Point, from: NodeId): NodeId | null => {
    const hit = hitAt(point)
    return hit?.kind === 'router' && hit.id !== from ? hit.id : null
  }

  const updateCursor = (canvas: HTMLCanvasElement) => {
    const press = pressRef.current
    const hover = hoverRef.current
    if (press?.moved && press.downHit === null) canvas.style.cursor = 'grabbing'
    else if (press?.linking) canvas.style.cursor = 'crosshair'
    else if (press?.moved) canvas.style.cursor = 'move'
    else if (hover?.kind === 'router')
      canvas.style.cursor = propsRef.current.linkMode ? 'crosshair' : 'move'
    else if (hover?.kind === 'link') canvas.style.cursor = 'pointer'
    else canvas.style.cursor = 'copy' // a click here adds a router
  }

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    const view = viewRef.current
    if (event.button !== 0 || view === null) return
    const point = localPoint(event.currentTarget, event)
    const downHit = hitAt(point)
    let grabOffset = { x: 0, y: 0 }
    if (downHit?.kind === 'router') {
      const center = propsRef.current.draft.positions[downHit.id]
      const grabbed = toWorld(view, point)
      grabOffset = { x: center.x - grabbed.x, y: center.y - grabbed.y }
    }
    const linking = downHit?.kind === 'router' && propsRef.current.linkMode !== event.shiftKey
    pressRef.current = { start: point, last: point, moved: false, downHit, linking, grabOffset }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(event.currentTarget, event)
    const press = pressRef.current
    const view = viewRef.current
    if (press === null || view === null) {
      hoverRef.current = hitAt(point)
    } else {
      if (Math.hypot(point.x - press.start.x, point.y - press.start.y) > CLICK_SLOP) {
        press.moved = true
      }
      const hit = press.downHit
      if (press.moved && hit === null) {
        viewRef.current = panBy(view, point.x - press.last.x, point.y - press.last.y)
        userMovedViewRef.current = true
      } else if (press.moved && hit?.kind === 'router' && press.linking) {
        pendingRef.current = { from: hit.id, pointer: point, target: linkTarget(point, hit.id) }
      } else if (press.moved && hit?.kind === 'router') {
        const world = toWorld(view, point)
        propsRef.current.onMoveRouter(hit.id, {
          x: world.x + press.grabOffset.x,
          y: world.y + press.grabOffset.y,
        })
      }
      press.last = point
    }
    updateCursor(event.currentTarget)
  }

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const press = pressRef.current
    const view = viewRef.current
    pressRef.current = null
    pendingRef.current = null
    if (press === null || view === null) return
    const point = localPoint(event.currentTarget, event)
    const hit = press.downHit
    if (!press.moved) {
      if (hit === null) propsRef.current.onAddRouter(toWorld(view, point))
      else if (hit.kind === 'router' || hit.kind === 'link') propsRef.current.onSelect(hit)
    } else if (hit?.kind === 'router' && press.linking) {
      const target = linkTarget(point, hit.id)
      if (target !== null) propsRef.current.onAddLink(hit.id, target)
    } else if (hit?.kind === 'router') {
      propsRef.current.onSelect(hit) // a moved router stays selected
    }
    hoverRef.current = hitAt(point)
    updateCursor(event.currentTarget)
  }

  const handlePointerCancel = () => {
    pressRef.current = null
    pendingRef.current = null
  }

  const routerCount = props.draft.graph.nodeCount

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-sky-800 bg-slate-900">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 px-3 py-2">
        <button
          type="button"
          onClick={fit}
          className="rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700"
        >
          Fit view
        </button>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={props.linkMode}
            onChange={(event) => props.onLinkModeChange(event.target.checked)}
            className="h-4 w-4 accent-sky-500"
          />
          Drag draws links
        </label>
        <span className="text-xs text-slate-500">
          Click empty space: add router · Drag router: {props.linkMode ? 'link' : 'move'} ·
          Shift+drag: {props.linkMode ? 'move' : 'link'} · Delete: remove selected · {routerCount}{' '}
          router{routerCount === 1 ? '' : 's'}
        </span>
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          aria-label="Topology editor"
          className="absolute inset-0 h-full w-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onPointerLeave={() => {
            if (pressRef.current === null) hoverRef.current = null
          }}
        />
        <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-slate-950 shadow">
          Editing: the simulation is paused
        </div>
      </div>
    </div>
  )
}
