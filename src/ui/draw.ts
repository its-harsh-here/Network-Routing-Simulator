import type { EdgeId, NodeId } from '../ds/Graph.ts'
import type { LinkSnapshot, RouterSnapshot, Snapshot } from '../sim/Simulator.ts'
import type { Point } from '../topology/presets.ts'
import {
  colorOnScale,
  CONTROL_MESSAGE_COLOR,
  DOWN_LINK_COLOR,
  DOWN_LINK_DASH,
  linkWidth,
  PRIORITY_COLORS,
  QUEUE_FILL_STOPS,
  UTILISATION_STOPS,
} from './colors.ts'
import type { BroadcastFrame } from './analysis.ts'
import type { Hit, PacketDot } from './hitTest.ts'
import { packetProgress, pointAlong } from './packets.ts'
import { toScreen, type View } from './view.ts'

/** Router circle radius in CSS pixels. */
export const ROUTER_RADIUS = 16
/** How close (CSS pixels) the pointer must be to a link to hover it. */
export const LINK_HOVER_TOLERANCE = 6
/** How close the pointer must be to a packet dot to click it: generous, as dots are small. */
export const PACKET_HIT_RADIUS = 9
const PACKET_RADIUS = 3.5
const PATH_COLOR = 'rgba(56, 189, 248, 0.55)'
const FORWARDING_COLOR = '#fbbf24'
const TRAIL_COLOR = 'rgba(255, 255, 255, 0.7)'
const INSPECTED_COLOR = '#fbbf24'
const MST_COLOR = 'rgba(52, 211, 153, 0.45)'
const WEAK_SPOT_COLOR = '#ef4444'
const BROADCAST_COLOR = '#34d399'
/** Packets travel this far to the right of the link's centre line, one side per direction. */
const PACKET_SIDE_OFFSET = 4
const FONT = 'ui-sans-serif, system-ui, sans-serif'

/** Everything one frame needs to draw. Sizes are in CSS pixels. */
export interface Scene {
  width: number
  height: number
  view: View
  positions: Readonly<Record<NodeId, Point>>
  snapshot: Snapshot
  queueCapacity: number
  hover: Hit
  /** Pointer position for the tooltip, or null when the pointer is outside the canvas. */
  pointer: Point | null
  /** A router to ring in blue, such as the source picked for a manual packet. */
  selectedRouter: NodeId | null
  /** A packet to draw larger with a white ring, such as one sent by hand. */
  highlightPacketId: number | null
  /** The router shown in the router inspector, ringed in amber. */
  inspectedRouter: NodeId | null
  /** The routers the inspected packet has visited: drawn as a trail ending at the packet. */
  packetTrail: { id: number; hops: readonly NodeId[] } | null
  /**
   * The shortest-path tool: the shortest path drawn wide, and the path the routers forward
   * along drawn dashed when it is different (while the network converges).
   */
  path: { shortest: readonly NodeId[] | null; forwarding: readonly NodeId[] | null } | null
  /** The analysis overlays; each is null when switched off. */
  overlays: {
    /** MST links, drawn under the links in green. */
    mst: ReadonlySet<EdgeId> | null
    /** Bridges, drawn red. */
    bridges: ReadonlySet<EdgeId> | null
    /** Articulation points, ringed in red. */
    articulationPoints: ReadonlySet<NodeId> | null
  }
  /** A broadcast in progress: its copies on the links and the routers that have it. */
  broadcast: BroadcastFrame | null
}

/** All overlays off. */
export const NO_OVERLAYS: Scene['overlays'] = { mst: null, bridges: null, articulationPoints: null }

/** Utilisation of a link: the busier of its two directions. O(1). */
export function linkUtilisation(link: LinkSnapshot): number {
  return Math.max(link.aToB.utilisation, link.bToA.utilisation)
}

/** How full a router's fullest output queue is, from 0 to 1. O(neighbours). */
export function queueFill(router: RouterSnapshot, queueCapacity: number): number {
  let longest = 0
  for (const length of Object.values(router.queueLengths)) longest = Math.max(longest, length)
  return longest / queueCapacity
}

/** Every router's centre in screen pixels. Time: O(V). */
export function screenPositions(
  positions: Readonly<Record<NodeId, Point>>,
  view: View,
): Map<NodeId, Point> {
  const screen = new Map<NodeId, Point>()
  for (const [id, point] of Object.entries(positions)) screen.set(id, toScreen(view, point))
  return screen
}

/**
 * Where each packet on a link is drawn, in screen pixels: along its link by how far it has
 * got, to the right of the centre line for its direction. Time: O(P).
 */
export function packetDots(snapshot: Snapshot, screen: ReadonlyMap<NodeId, Point>): PacketDot[] {
  return snapshot.packets.map((packet) => ({
    id: packet.id,
    point: pointAlong(
      screen.get(packet.from) as Point,
      screen.get(packet.to) as Point,
      packetProgress(packet.departTime, packet.arriveTime, snapshot.time),
      PACKET_SIDE_OFFSET,
    ),
  }))
}

/**
 * Draws one frame: links, the path highlights, then routing messages and packets on the links,
 * then routers on top, then the tooltip.
 * The context's transform must already scale CSS pixels to device pixels.
 * Time: O(V + E + P) for P packets on links.
 */
export function drawScene(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const { snapshot, view, hover } = scene
  ctx.clearRect(0, 0, scene.width, scene.height)

  const screen = screenPositions(scene.positions, view)
  const dots = packetDots(snapshot, screen)

  const { overlays, broadcast } = scene
  const ends = (link: LinkSnapshot) => [screen.get(link.a) as Point, screen.get(link.b) as Point]
  if (overlays.mst !== null) {
    for (const link of snapshot.links) {
      if (overlays.mst.has(link.id)) strokePoints(ctx, ends(link), 11, MST_COLOR, [])
    }
  }
  for (const link of snapshot.links) {
    const isHovered = hover?.kind === 'link' && hover.id === link.id
    drawLink(ctx, link, screen.get(link.a) as Point, screen.get(link.b) as Point, isHovered)
  }
  if (overlays.bridges !== null) {
    for (const link of snapshot.links) {
      if (link.up && overlays.bridges.has(link.id)) {
        strokePoints(ctx, ends(link), 3, WEAK_SPOT_COLOR, [])
      }
    }
  }

  if (scene.path !== null) {
    const { shortest, forwarding } = scene.path
    if (shortest !== null) drawPolyline(ctx, shortest, screen, 10, PATH_COLOR, [])
    if (forwarding !== null) drawPolyline(ctx, forwarding, screen, 2.5, FORWARDING_COLOR, [7, 5])
  }
  if (scene.packetTrail !== null) {
    const { id, hops } = scene.packetTrail
    const trail = hops.map((router) => screen.get(router) as Point)
    const dot = dots.find((d) => d.id === id)
    if (dot !== undefined) trail.push(dot.point) // on to where the packet is now
    strokePoints(ctx, trail, 3, TRAIL_COLOR, [2, 4])
  }

  // Routing messages: small squares on the centre line (packets travel to either side of it).
  for (const message of snapshot.controlMessages) {
    const progress = packetProgress(message.departTime, message.arriveTime, snapshot.time)
    const position = pointAlong(
      screen.get(message.from) as Point,
      screen.get(message.to) as Point,
      progress,
    )
    ctx.fillStyle = CONTROL_MESSAGE_COLOR
    ctx.fillRect(position.x - 3, position.y - 3, 6, 6)
  }

  snapshot.packets.forEach((packet, i) => {
    const position = dots[i].point
    const isHighlighted = packet.id === scene.highlightPacketId
    ctx.beginPath()
    ctx.arc(position.x, position.y, isHighlighted ? 6 : PACKET_RADIUS, 0, 2 * Math.PI)
    ctx.fillStyle = PRIORITY_COLORS[packet.priority]
    ctx.fill()
    ctx.lineWidth = isHighlighted ? 2.5 : 1
    ctx.strokeStyle = isHighlighted ? '#ffffff' : 'rgba(2, 6, 23, 0.8)'
    ctx.stroke()
  })

  // Broadcast copies: diamonds, green if they bring the message, red if the router has it already.
  if (broadcast !== null) {
    for (const message of broadcast.messages) {
      if (broadcast.elapsedMs < message.sendAt || broadcast.elapsedMs >= message.arriveAt) continue
      const progress = packetProgress(message.sendAt, message.arriveAt, broadcast.elapsedMs)
      const at = pointAlong(
        screen.get(message.from) as Point,
        screen.get(message.to) as Point,
        progress,
      )
      ctx.beginPath()
      ctx.moveTo(at.x, at.y - 5)
      ctx.lineTo(at.x + 5, at.y)
      ctx.lineTo(at.x, at.y + 5)
      ctx.lineTo(at.x - 5, at.y)
      ctx.closePath()
      ctx.fillStyle = message.duplicate ? WEAK_SPOT_COLOR : BROADCAST_COLOR
      ctx.fill()
    }
  }

  for (const router of snapshot.routers) {
    const isHovered = hover?.kind === 'router' && hover.id === router.id
    const center = screen.get(router.id) as Point
    if (overlays.articulationPoints?.has(router.id)) {
      drawRing(ctx, center, WEAK_SPOT_COLOR, ROUTER_RADIUS + 9)
    }
    const reachedAt = broadcast?.reached.get(router.id)
    if (reachedAt !== undefined && reachedAt <= (broadcast as BroadcastFrame).elapsedMs) {
      drawRing(ctx, center, BROADCAST_COLOR, ROUTER_RADIUS + 3)
    }
    if (router.id === scene.selectedRouter) drawRing(ctx, center, '#38bdf8')
    else if (router.id === scene.inspectedRouter) drawRing(ctx, center, INSPECTED_COLOR)
    const fill = queueFill(router, scene.queueCapacity)
    drawRouter(ctx, router.id, center, fill, isHovered)
  }

  if (hover !== null && scene.pointer !== null) {
    const lines = tooltipLines(hover, snapshot, scene.queueCapacity)
    if (lines.length > 0) drawTooltip(ctx, lines, scene.pointer, scene.width, scene.height)
  }
}

function drawLink(
  ctx: CanvasRenderingContext2D,
  link: LinkSnapshot,
  a: Point,
  b: Point,
  isHovered: boolean,
): void {
  const width = link.up ? linkWidth(linkUtilisation(link)) : 2
  if (isHovered) {
    strokeLine(ctx, a, b, width + 6, 'rgba(255, 255, 255, 0.35)', [])
  }
  if (link.up) {
    strokeLine(ctx, a, b, width, colorOnScale(UTILISATION_STOPS, linkUtilisation(link)), [])
  } else {
    strokeLine(ctx, a, b, width, DOWN_LINK_COLOR, DOWN_LINK_DASH)
  }
}

function strokeLine(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  width: number,
  color: string,
  dash: readonly number[],
): void {
  ctx.beginPath()
  ctx.moveTo(a.x, a.y)
  ctx.lineTo(b.x, b.y)
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.strokeStyle = color
  ctx.setLineDash(dash)
  ctx.stroke()
  ctx.setLineDash([])
}

/** A line through the routers' centres, in order. */
function drawPolyline(
  ctx: CanvasRenderingContext2D,
  routers: readonly NodeId[],
  screen: ReadonlyMap<NodeId, Point>,
  width: number,
  color: string,
  dash: readonly number[],
): void {
  const points = routers.map((id) => screen.get(id) as Point)
  strokePoints(ctx, points, width, color, dash)
}

/**
 * A line through the points, in order. Nothing for fewer than two points.
 * Time: O(points).
 */
export function strokePoints(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  width: number,
  color: string,
  dash: readonly number[],
): void {
  if (points.length < 2) return
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  for (const point of points.slice(1)) ctx.lineTo(point.x, point.y)
  ctx.lineWidth = width
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color
  ctx.setLineDash(dash)
  ctx.stroke()
  ctx.setLineDash([])
}

/**
 * A coloured ring around a router: the picked source, the inspected router, an overlay.
 * Time: O(1).
 */
export function drawRing(
  ctx: CanvasRenderingContext2D,
  center: Point,
  color: string,
  radius = ROUTER_RADIUS + 5,
): void {
  ctx.beginPath()
  ctx.arc(center.x, center.y, radius, 0, 2 * Math.PI)
  ctx.lineWidth = 3
  ctx.strokeStyle = color
  ctx.stroke()
}

/**
 * A router: a filled circle with its name. `fill` is how full its queues are (0 to 1), or a
 * colour (the editor draws plain routers).
 * Time: O(1).
 */
export function drawRouter(
  ctx: CanvasRenderingContext2D,
  id: NodeId,
  center: Point,
  fill: number | string,
  isHovered: boolean,
): void {
  ctx.beginPath()
  ctx.arc(center.x, center.y, ROUTER_RADIUS, 0, 2 * Math.PI)
  ctx.fillStyle = typeof fill === 'number' ? colorOnScale(QUEUE_FILL_STOPS, fill) : fill
  ctx.fill()
  ctx.lineWidth = isHovered ? 3 : 1.5
  ctx.strokeStyle = isHovered ? '#ffffff' : '#0f172a'
  ctx.stroke()

  ctx.fillStyle = '#0f172a'
  ctx.font = `600 10px ${FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(id, center.x, center.y)
}

/** The tooltip text for whatever is hovered. Time: O(V + E) to find it in the snapshot. */
export function tooltipLines(
  hover: NonNullable<Hit>,
  snapshot: Snapshot,
  queueCapacity: number,
): string[] {
  if (hover.kind === 'packet') {
    const packet = snapshot.packets.find((p) => p.id === hover.id)
    if (packet === undefined) return []
    return [
      `Packet #${packet.id} (${packet.priority})`,
      `${packet.src} → ${packet.dst}, now on ${packet.from} → ${packet.to}`,
      'click to inspect it',
    ]
  }
  if (hover.kind === 'router') {
    const router = snapshot.routers.find((r) => r.id === hover.id)
    if (router === undefined) return []
    const entries = Object.entries(router.queueLengths)
    const [fullestTo, fullestLength] = entries.reduce(
      (best, entry) => (entry[1] > best[1] ? entry : best),
      ['-', 0] as [string, number],
    )
    return [
      `Router ${router.id}`,
      `queued: ${router.queued} packet${router.queued === 1 ? '' : 's'}`,
      `fullest queue: ${fullestLength}/${queueCapacity}` +
        (fullestLength > 0 ? ` (to ${fullestTo})` : ''),
      `links: ${entries.length}`,
      'click to inspect it',
    ]
  }
  const link = snapshot.links.find((l) => l.id === hover.id)
  if (link === undefined) return []
  const direction = (d: LinkSnapshot['aToB']) =>
    `${d.from} → ${d.to}: ${Math.round(d.utilisation * 100)}% busy, ${d.queueLength} queued`
  return [
    `Link ${link.id} (${link.up ? 'up' : 'DOWN'})`,
    `cost ${link.cost} · ${formatBandwidth(link.bandwidthBps)} · ${link.delayMs} ms`,
    direction(link.aToB),
    direction(link.bToA),
    link.up ? 'click to cut this link' : 'click to restore this link',
  ]
}

/** "10 Mbps", "1.5 Gbps", "800 kbps". Time: O(1). */
export function formatBandwidth(bps: number): string {
  if (bps >= 1e9) return `${+(bps / 1e9).toFixed(2)} Gbps`
  if (bps >= 1e6) return `${+(bps / 1e6).toFixed(2)} Mbps`
  if (bps >= 1e3) return `${+(bps / 1e3).toFixed(2)} kbps`
  return `${bps} bps`
}

/** Draws a box of text near the pointer, flipped to stay inside the canvas. */
function drawTooltip(
  ctx: CanvasRenderingContext2D,
  lines: string[],
  pointer: Point,
  width: number,
  height: number,
): void {
  const padding = 8
  const lineHeight = 16
  ctx.font = `12px ${FONT}`
  const textWidth = Math.max(...lines.map((line) => ctx.measureText(line).width))
  const boxWidth = textWidth + 2 * padding
  const boxHeight = lines.length * lineHeight + 2 * padding - 4
  let x = pointer.x + 14
  let y = pointer.y + 14
  if (x + boxWidth > width) x = pointer.x - 14 - boxWidth
  if (y + boxHeight > height) y = pointer.y - 14 - boxHeight
  x = Math.max(4, x)
  y = Math.max(4, y)

  ctx.beginPath()
  ctx.roundRect(x, y, boxWidth, boxHeight, 6)
  ctx.fillStyle = 'rgba(15, 23, 42, 0.95)'
  ctx.fill()
  ctx.lineWidth = 1
  ctx.strokeStyle = '#334155'
  ctx.stroke()

  ctx.textAlign = 'left'
  ctx.textBaseline = 'top'
  lines.forEach((line, i) => {
    ctx.font = i === 0 ? `600 12px ${FONT}` : `12px ${FONT}`
    ctx.fillStyle = i === 0 ? '#f8fafc' : '#cbd5e1'
    ctx.fillText(line, x + padding, y + padding + i * lineHeight)
  })
}
