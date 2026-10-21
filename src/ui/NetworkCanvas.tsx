import { memo, useEffect, useRef, type PointerEvent } from 'react'
import type { EdgeId, NodeId } from '../ds/Graph.ts'
import type { Packet } from '../sim/Packet.ts'
import type { Snapshot } from '../sim/Simulator.ts'
import type { Point } from '../topology/presets.ts'
import { CLICK_SLOP, fittedView, localPoint, screenGeometry, useWheelZoom } from './canvasInput.ts'
import {
  drawScene,
  LINK_HOVER_TOLERANCE,
  PACKET_HIT_RADIUS,
  packetDots,
  ROUTER_RADIUS,
} from './draw.ts'
import {
  analyzeNetwork,
  broadcastFrame,
  type BroadcastDemo,
  type NetworkAnalysis,
  type OverlayToggles,
} from './analysis.ts'
import { advanceFrame } from './frameLoop.ts'
import { hitTest, type Hit } from './hitTest.ts'
import { inspectPacket, inspectPath, inspectRouter, type PathInspection } from './inspect.ts'
import Legend from './Legend.tsx'
import { buildPanelData, chartFrom, NO_CHART, type ChartData, type PanelData } from './panel.ts'
import type { Simulation } from './simulation.ts'
import { panBy, type View } from './view.ts'

/** Real time the simulation may use per frame, leaving the rest of a 60 Hz frame for drawing. */
const FRAME_BUDGET_MS = 8
/** Longest real-time step per frame. A longer gap (say, a background tab) is not caught up. */
const MAX_FRAME_DELTA_MS = 100
/** The side panel is updated at most 4 times per second. */
const PANEL_INTERVAL_MS = 250
/** The lagging badge stays up this long after the last slow frame, so it does not flicker. */
const LAG_BADGE_HOLD_MS = 1_000
/** The charts get new data at most twice a second, which keeps them cheap to redraw. */
const CHART_INTERVAL_MS = 500

interface Props {
  simulation: Simulation
  speed: number
  paused: boolean
  /** Instruction shown over the canvas while picking routers, or null. */
  pickPrompt: string | null
  /** Router drawn with a blue ring (the picked source), or null. */
  selectedRouter: NodeId | null
  /** Packet drawn larger (one sent by hand, or the inspected one), or null. */
  highlightPacketId: number | null
  /** The router in the router inspector, ringed in amber. */
  inspectedRouter: NodeId | null
  /** The packet in the packet inspector: its path so far is drawn. */
  inspectedPacket: Packet | null
  /** The two routers of the shortest-path tool, or null. */
  pathEnds: { from: NodeId; to: NodeId } | null
  overlays: OverlayToggles
  /** A broadcast to play on the map, or null. */
  broadcast: BroadcastDemo | null
  onRouterClick: (id: NodeId) => void
  onLinkClick: (id: EdgeId) => void
  onPacketClick: (id: number) => void
  onPanelUpdate: (data: PanelData) => void
  onEdit: () => void
}

/** A mouse button or finger that is down on the canvas. */
interface Press {
  start: Point
  last: Point
  moved: boolean
  /** What was under the pointer when it went down. Dragging pans only from empty space. */
  downHit: Hit
}

/**
 * The live network view. A requestAnimationFrame loop advances the simulation, takes a
 * snapshot and draws it, reading everything it needs from refs. React re-renders this component
 * only when a prop changes (a user action), never per frame, and the side panel, with the
 * inspectors' data, is fed at most 4 times a second.
 * Each frame: O(V + E + P) to draw, P packets on links; each pointer event hit-tests in O(V + E + P).
 */
function NetworkCanvas(props: Props) {
  const { simulation } = props
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const badgeRef = useRef<HTMLDivElement>(null)
  /** The latest props, for the frame loop and the pointer handlers. */
  const propsRef = useRef(props)
  /** Canvas size in CSS pixels, kept up to date by a ResizeObserver. */
  const sizeRef = useRef({ width: 0, height: 0 })
  const viewRef = useRef<View | null>(null)
  const fitScaleRef = useRef(1)
  const userMovedViewRef = useRef(false)
  const hoverRef = useRef<Hit>(null)
  const pointerRef = useRef<Point | null>(null)
  const pressRef = useRef<Press | null>(null)
  /** The snapshot drawn last, for hit-testing packets where they were drawn. */
  const snapshotRef = useRef<Snapshot | null>(null)
  /** The shortest-path tool's result, refreshed with the side panel. */
  const pathRef = useRef<PathInspection | null>(null)

  useEffect(() => {
    propsRef.current = props
  })
  useWheelZoom(canvasRef, viewRef, fitScaleRef, userMovedViewRef)

  // The frame loop. It restarts, with a freshly fitted view, whenever a new simulation is loaded.
  useEffect(() => {
    const container = containerRef.current
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!container || !canvas || !ctx) return
    const { sim, topology } = simulation
    viewRef.current = null
    userMovedViewRef.current = false
    hoverRef.current = null
    pathRef.current = null

    const resizeObserver = new ResizeObserver(([entry]) => {
      sizeRef.current = { width: entry.contentRect.width, height: entry.contentRect.height }
    })
    resizeObserver.observe(container)

    let backing = { width: 0, height: 0, dpr: 0 }
    let lastWall = performance.now()
    let lastPanel = -Infinity
    let laggingUntil = -Infinity
    let badgeVisible = false
    let frameId = 0
    // The analysis of the network as it is, redone only when a link goes down or up.
    let analysis: {
      version: number
      result: NetworkAnalysis
      mst: Set<EdgeId>
      bridges: Set<EdgeId>
      articulationPoints: Set<NodeId>
    } | null = null
    let chart: ChartData = NO_CHART
    let lastChart = -Infinity

    const frame = (wallNow: number) => {
      const current = propsRef.current
      // Match the canvas's pixel buffer to its CSS size times devicePixelRatio, so lines stay
      // crisp on high-density screens. Checked every frame, since the ratio changes when the
      // window moves to another monitor.
      const { width, height } = sizeRef.current
      const dpr = window.devicePixelRatio || 1
      if (width !== backing.width || height !== backing.height || dpr !== backing.dpr) {
        backing = { width, height, dpr }
        canvas.width = Math.round(width * dpr)
        canvas.height = Math.round(height * dpr)
        if (!userMovedViewRef.current || viewRef.current === null) {
          viewRef.current = fittedView(topology, width, height)
          fitScaleRef.current = viewRef.current.scale
        }
      }

      const wallDelta = Math.min(wallNow - lastWall, MAX_FRAME_DELTA_MS)
      lastWall = wallNow
      if (!current.paused) {
        const { lagging } = advanceFrame(sim, wallDelta, current.speed, FRAME_BUDGET_MS, () =>
          performance.now(),
        )
        if (lagging) laggingUntil = wallNow + LAG_BADGE_HOLD_MS
      }

      const snapshot = sim.snapshot()
      snapshotRef.current = snapshot
      if (analysis === null || analysis.version !== sim.linkChangeCount) {
        const result = analyzeNetwork(sim.graph)
        analysis = {
          version: sim.linkChangeCount,
          result,
          mst: new Set(result.mstLinks),
          bridges: new Set(result.bridges),
          articulationPoints: new Set(result.articulationPoints),
        }
      }
      const ends = current.pathEnds
      // Recompute the path with the panel, or at once when the tool has just been pointed at
      // a new pair of routers.
      const pathStale =
        ends !== null && (pathRef.current?.from !== ends.from || pathRef.current?.to !== ends.to)
      const panelDue = wallNow - lastPanel >= PANEL_INTERVAL_MS
      if (ends === null) pathRef.current = null
      else if (panelDue || pathStale) pathRef.current = inspectPath(sim, ends.from, ends.to)

      if (viewRef.current !== null && width > 0 && height > 0) {
        const path = pathRef.current
        const packet = current.inspectedPacket
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0) // draw in CSS pixels
        drawScene(ctx, {
          width,
          height,
          view: viewRef.current,
          positions: topology.positions,
          snapshot,
          queueCapacity: sim.config.queueCapacity,
          hover: hoverRef.current,
          pointer: pointerRef.current,
          selectedRouter: current.selectedRouter,
          highlightPacketId: current.highlightPacketId,
          inspectedRouter: current.inspectedRouter,
          packetTrail: packet === null ? null : { id: packet.id, hops: packet.hops },
          path:
            path === null
              ? null
              : {
                  shortest: path.shortest?.path ?? null,
                  forwarding: path.agrees ? null : path.forwarding.path,
                },
          overlays: {
            mst: current.overlays.mst ? analysis.mst : null,
            bridges: current.overlays.weakSpots ? analysis.bridges : null,
            articulationPoints: current.overlays.weakSpots ? analysis.articulationPoints : null,
          },
          broadcast: current.broadcast === null ? null : broadcastFrame(current.broadcast, sim.now),
        })
      }

      const showBadge = wallNow < laggingUntil
      if (showBadge !== badgeVisible && badgeRef.current !== null) {
        badgeRef.current.hidden = !showBadge
        badgeVisible = showBadge
      }
      if (panelDue) {
        lastPanel = wallNow
        const routerId = current.inspectedRouter
        const packet = current.inspectedPacket
        const samples = [...sim.stats.network]
        if (wallNow - lastChart >= CHART_INTERVAL_MS) {
          lastChart = wallNow
          const windowMs = sim.config.maxSamples * sim.config.statsIntervalMs
          chart = chartFrom(samples, snapshot.convergence, sim.now, windowMs)
        }
        current.onPanelUpdate(
          buildPanelData(snapshot, sim.stats.windowStats(sim.now), samples, sim.routingTables(), {
            inspector: {
              router: routerId === null ? null : inspectRouter(sim, routerId),
              packet: packet === null ? null : inspectPacket(packet, sim, snapshot),
              path: pathRef.current,
            },
            analysis: analysis.result,
            log: sim.log.toArray(),
            chart,
          }),
        )
      }
      frameId = requestAnimationFrame(frame)
    }

    frameId = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
    }
  }, [simulation])

  const hitAt = (point: Point): Hit => {
    const view = viewRef.current
    if (view === null) return null
    const { routers, links } = screenGeometry(simulation.topology, view)
    const snapshot = snapshotRef.current
    const dots = snapshot === null ? [] : packetDots(snapshot, routers)
    return hitTest(
      point,
      routers,
      links,
      ROUTER_RADIUS,
      LINK_HOVER_TOLERANCE,
      dots,
      PACKET_HIT_RADIUS,
    )
  }

  const updateCursor = (canvas: HTMLCanvasElement) => {
    const press = pressRef.current
    const hover = hoverRef.current
    if (press !== null && press.moved && press.downHit === null) canvas.style.cursor = 'grabbing'
    else if (hover !== null) canvas.style.cursor = 'pointer'
    else canvas.style.cursor = 'grab'
  }

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return
    const point = localPoint(event.currentTarget, event)
    pressRef.current = { start: point, last: point, moved: false, downHit: hitAt(point) }
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const point = localPoint(event.currentTarget, event)
    pointerRef.current = point
    const press = pressRef.current
    if (press === null) {
      hoverRef.current = hitAt(point)
    } else {
      const distance = Math.hypot(point.x - press.start.x, point.y - press.start.y)
      if (distance > CLICK_SLOP) press.moved = true
      if (press.moved && press.downHit === null && viewRef.current !== null) {
        viewRef.current = panBy(viewRef.current, point.x - press.last.x, point.y - press.last.y)
        userMovedViewRef.current = true
      }
      press.last = point
    }
    updateCursor(event.currentTarget)
  }

  const handlePointerUp = (event: PointerEvent<HTMLCanvasElement>) => {
    const press = pressRef.current
    pressRef.current = null
    const hit = press?.downHit ?? null
    if (press !== null && !press.moved && hit !== null) {
      if (hit.kind === 'link') props.onLinkClick(hit.id)
      if (hit.kind === 'router') props.onRouterClick(hit.id)
      if (hit.kind === 'packet') props.onPacketClick(hit.id)
    }
    hoverRef.current = hitAt(localPoint(event.currentTarget, event))
    updateCursor(event.currentTarget)
  }

  const handlePointerLeave = () => {
    if (pressRef.current !== null) return // still dragging: pointer capture keeps the events coming
    hoverRef.current = null
    pointerRef.current = null
  }

  const fitToCanvas = () => {
    const { width, height } = sizeRef.current
    viewRef.current = fittedView(simulation.topology, width, height)
    fitScaleRef.current = viewRef.current.scale
    userMovedViewRef.current = false
  }

  const toolbarButton =
    'rounded-md bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 ring-1 ring-slate-700 hover:bg-slate-700'
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-slate-800 bg-slate-900">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-slate-800 px-3 py-2">
        <div className="flex gap-2">
          <button type="button" onClick={fitToCanvas} className={toolbarButton}>
            Fit view
          </button>
          <button type="button" onClick={props.onEdit} className={toolbarButton}>
            Edit topology
          </button>
        </div>
        <Legend />
      </div>
      <div ref={containerRef} className="relative min-h-0 flex-1">
        <canvas
          ref={canvasRef}
          aria-label="Network map"
          className="absolute inset-0 h-full w-full touch-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerLeave={handlePointerLeave}
        />
        {props.pickPrompt !== null && (
          <div className="pointer-events-none absolute top-2 left-1/2 -translate-x-1/2 rounded-full bg-sky-500 px-3 py-1 text-xs font-semibold text-slate-950 shadow">
            {props.pickPrompt}
          </div>
        )}
        {/* Floats over the canvas so showing it never changes the canvas size. */}
        <div
          ref={badgeRef}
          hidden
          role="status"
          className="pointer-events-none absolute top-2 right-2 rounded-full bg-amber-500 px-3 py-1 text-xs font-semibold text-slate-950 shadow"
        >
          Lagging: the engine can't keep up at this speed
        </div>
      </div>
    </div>
  )
}

export default memo(NetworkCanvas)
