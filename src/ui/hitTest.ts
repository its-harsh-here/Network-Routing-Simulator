import type { EdgeId, NodeId } from '../ds/Graph.ts'
import type { Point } from '../topology/presets.ts'

/** What the pointer is over: a router, a packet, a link, or nothing. */
export type Hit =
  | { kind: 'router'; id: NodeId }
  | { kind: 'packet'; id: number }
  | { kind: 'link'; id: EdgeId }
  | null

/** What the editor can select: a router or a link. */
export type Selection = { kind: 'router'; id: NodeId } | { kind: 'link'; id: EdgeId } | null

/** A packet dot's id and where it is drawn, in screen pixels. */
export interface PacketDot {
  id: number
  point: Point
}

/** A link's id and its two ends, in screen pixels. */
export interface LinkSegment {
  id: EdgeId
  a: Point
  b: Point
}

/**
 * Shortest distance from `p` to the line segment from `a` to `b`. Projects p onto the line,
 * clamps the projection to the segment, and measures to that point. Time: O(1).
 */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lengthSquared = dx * dx + dy * dy
  // t is how far along the segment the projection falls: 0 at a, 1 at b.
  const t =
    lengthSquared === 0
      ? 0
      : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * Finds what is under screen point `p`. Routers are drawn on top, so they win: the nearest
 * router within `routerRadius`. Then the nearest packet within `packetRadius`, and last the
 * nearest link within `linkTolerance`.
 * Time: O(V + P + E) for P packets.
 */
export function hitTest(
  p: Point,
  routers: ReadonlyMap<NodeId, Point>,
  links: readonly LinkSegment[],
  routerRadius: number,
  linkTolerance: number,
  packets: readonly PacketDot[] = [],
  packetRadius = 0,
): Hit {
  let bestRouter: NodeId | null = null
  let bestRouterDistance = routerRadius
  for (const [id, center] of routers) {
    const distance = Math.hypot(p.x - center.x, p.y - center.y)
    if (distance <= bestRouterDistance) {
      bestRouter = id
      bestRouterDistance = distance
    }
  }
  if (bestRouter !== null) return { kind: 'router', id: bestRouter }

  let bestPacket: number | null = null
  let bestPacketDistance = packetRadius
  for (const packet of packets) {
    const distance = Math.hypot(p.x - packet.point.x, p.y - packet.point.y)
    if (distance <= bestPacketDistance) {
      bestPacket = packet.id
      bestPacketDistance = distance
    }
  }
  if (bestPacket !== null) return { kind: 'packet', id: bestPacket }

  let bestLink: EdgeId | null = null
  let bestLinkDistance = linkTolerance
  for (const link of links) {
    const distance = distanceToSegment(p, link.a, link.b)
    if (distance <= bestLinkDistance) {
      bestLink = link.id
      bestLinkDistance = distance
    }
  }
  return bestLink === null ? null : { kind: 'link', id: bestLink }
}
