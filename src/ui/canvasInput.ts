// Pointer, wheel and keyboard helpers shared by the live canvas and the editor canvas.
import { useEffect, type RefObject } from 'react'
import type { NodeId } from '../ds/Graph.ts'
import type { Point, Topology } from '../topology/presets.ts'
import { screenPositions } from './draw.ts'
import type { LinkSegment } from './hitTest.ts'
import { fitView, zoomAt, type View } from './view.ts'

/** A press that moves less than this many pixels is a click, not a drag. */
export const CLICK_SLOP = 4
/** Space kept clear around the network when the view is fitted to the canvas. */
export const FIT_PADDING = 48
/** Zoom limits, relative to the fitted view. */
const MIN_ZOOM = 0.25
const MAX_ZOOM = 20

/**
 * The pointer position relative to the canvas, in CSS pixels.
 * Time: O(1).
 */
export function localPoint(
  canvas: HTMLCanvasElement,
  event: { clientX: number; clientY: number },
): Point {
  const rect = canvas.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

/** The view that fits the whole topology into a canvas of the given size. O(V). */
export function fittedView(topology: Topology, width: number, height: number): View {
  return fitView(Object.values(topology.positions), width, height, FIT_PADDING)
}

/** Router centres and link segments in screen pixels, for hit-testing. O(V + E). */
export function screenGeometry(
  topology: Topology,
  view: View,
): { routers: Map<NodeId, Point>; links: LinkSegment[] } {
  const routers = screenPositions(topology.positions, view)
  const links: LinkSegment[] = topology.graph.edges().map((edge) => ({
    id: edge.id,
    a: routers.get(edge.a) as Point,
    b: routers.get(edge.b) as Point,
  }))
  return { routers, links }
}

/**
 * True if a key press is meant for a text field or menu, not for a keyboard shortcut.
 * Time: O(1).
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLInputElement &&
        !['range', 'checkbox', 'button'].includes(target.type)))
  )
}

/**
 * Zooms the view with the mouse wheel, around the pointer, within limits relative to the
 * fitted scale. Registered by hand because React's wheel listener is passive and cannot stop
 * the page from scrolling.
 * Time: O(1) per wheel event.
 */
export function useWheelZoom(
  canvasRef: RefObject<HTMLCanvasElement | null>,
  viewRef: RefObject<View | null>,
  fitScaleRef: RefObject<number>,
  userMovedViewRef: RefObject<boolean>,
): void {
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (event: WheelEvent) => {
      event.preventDefault()
      const view = viewRef.current
      if (view === null) return
      const pixels =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE ? event.deltaY * 16 : event.deltaY
      const fit = fitScaleRef.current
      viewRef.current = zoomAt(
        view,
        Math.exp(-pixels * 0.0015),
        localPoint(canvas, event),
        fit * MIN_ZOOM,
        fit * MAX_ZOOM,
      )
      userMovedViewRef.current = true
    }
    canvas.addEventListener('wheel', onWheel, { passive: false })
    return () => canvas.removeEventListener('wheel', onWheel)
  }, [canvasRef, viewRef, fitScaleRef, userMovedViewRef])
}
