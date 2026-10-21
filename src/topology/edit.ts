// Topology editing. Every function returns a new topology and leaves the one it was given
// unchanged, so the editor can keep its draft in React state (and an old draft stays valid).
import { Graph, type EdgeId, type NodeId } from '../ds/Graph.ts'
import { UnionFind } from '../ds/UnionFind.ts'
import type { Point, Topology } from './presets.ts'

/** The link settings the editor can change. */
export interface LinkFields {
  cost: number
  bandwidthBps: number
  delayMs: number
}

/** Copies a topology: a new graph and a new positions object. Time: O(V + E). */
export function cloneTopology(topology: Topology): Topology {
  return {
    name: topology.name,
    graph: topology.graph.clone(),
    positions: { ...topology.positions },
  }
}

/**
 * The network as designed: a copy with every link up, without the failures of a running
 * simulation (which marks links down in its graph). Time: O(V + E).
 */
export function withAllLinksUp(topology: Topology): Topology {
  const copy = cloneTopology(topology)
  for (const edge of copy.graph.edges()) {
    if (!edge.up) copy.graph.setEdgeUp(edge.id, true)
  }
  return copy
}

/** A network with no routers. Time: O(1). */
export function emptyTopology(name = 'custom'): Topology {
  return { name, graph: new Graph(), positions: {} }
}

/** The first unused router name of the form R0, R1, R2, ... Time: O(V). */
export function nextRouterId(topology: Topology): NodeId {
  for (let i = 0; ; i++) {
    if (!topology.graph.hasNode(`R${i}`)) return `R${i}`
  }
}

/** Adds a router drawn at `point`, named by nextRouterId. Time: O(V + E) for the copy. */
export function addRouter(topology: Topology, point: Point): { topology: Topology; id: NodeId } {
  const copy = cloneTopology(topology)
  const id = nextRouterId(copy)
  copy.graph.addNode(id)
  copy.positions[id] = { x: point.x, y: point.y }
  return { topology: copy, id }
}

/**
 * Moves router `id` to `point`. Only the positions change, so the result shares the (unchanged)
 * graph: moving is O(V) and cheap enough to run on every pointer move.
 * @throws Error if there is no such router.
 */
export function moveRouter(topology: Topology, id: NodeId, point: Point): Topology {
  requireRouter(topology, id)
  return { ...topology, positions: { ...topology.positions, [id]: { x: point.x, y: point.y } } }
}

/**
 * Removes router `id` and every link to it. Time: O(V + E).
 * @throws Error if there is no such router.
 */
export function removeRouter(topology: Topology, id: NodeId): Topology {
  requireRouter(topology, id)
  const copy = cloneTopology(topology)
  copy.graph.removeNode(id)
  delete copy.positions[id]
  return copy
}

/**
 * Problems with link settings, as sentences for the user; empty if they are fine. The rules
 * are the Graph's: cost and bandwidth above 0, delay 0 or more, all finite. Time: O(1).
 */
export function linkFieldErrors(fields: LinkFields): string[] {
  const errors: string[] = []
  if (!(Number.isFinite(fields.cost) && fields.cost > 0)) {
    errors.push('Cost must be a number greater than 0.')
  }
  if (!(Number.isFinite(fields.bandwidthBps) && fields.bandwidthBps > 0)) {
    errors.push('Bandwidth must be a number greater than 0.')
  }
  if (!(Number.isFinite(fields.delayMs) && fields.delayMs >= 0)) {
    errors.push('Delay must be a number of 0 or more.')
  }
  return errors
}

/**
 * Links routers `a` and `b`. The link's id is "a-b" (with "#2", "#3", ... added in the unlikely
 * case that id is taken). Time: O(V + E) for the copy.
 * @throws Error if a and b are the same router, are already linked, or a router is missing.
 * @throws RangeError if the settings are invalid (see linkFieldErrors).
 */
export function addLink(
  topology: Topology,
  a: NodeId,
  b: NodeId,
  fields: LinkFields,
): { topology: Topology; id: EdgeId } {
  requireRouter(topology, a)
  requireRouter(topology, b)
  if (a === b) throw new Error('A link cannot join a router to itself.')
  if (topology.graph.edgeBetween(a, b) !== undefined) {
    throw new Error(`${a} and ${b} are already linked.`)
  }
  requireValidFields(fields)
  let id = `${a}-${b}`
  for (let n = 2; topology.graph.getEdge(id) !== undefined; n++) id = `${a}-${b}#${n}`
  const copy = cloneTopology(topology)
  copy.graph.addEdge(a, b, { id, ...fields })
  return { topology: copy, id }
}

/**
 * Changes link `id`'s cost, bandwidth and delay, keeping its id, ends and up/down state.
 * Time: O(V + E) for the copy.
 * @throws Error if there is no such link.
 * @throws RangeError if the settings are invalid (see linkFieldErrors).
 */
export function updateLink(topology: Topology, id: EdgeId, fields: LinkFields): Topology {
  const edge = requireLink(topology, id)
  requireValidFields(fields)
  const copy = cloneTopology(topology)
  // Edges are immutable, so the link is replaced by a new one with the same id.
  copy.graph.removeEdge(id)
  copy.graph.addEdge(edge.a, edge.b, { id, up: edge.up, ...fields })
  return copy
}

/**
 * Removes link `id`. Time: O(V + E) for the copy.
 * @throws Error if there is no such link.
 */
export function removeLink(topology: Topology, id: EdgeId): Topology {
  requireLink(topology, id)
  const copy = cloneTopology(topology)
  copy.graph.removeEdge(id)
  return copy
}

/**
 * Into how many separate parts the links divide the routers (0 for an empty network). One
 * union per link with UnionFind. Time: O(V + E α(V)).
 */
export function countParts(topology: Topology): number {
  const parts = new UnionFind(topology.graph.nodes())
  for (const edge of topology.graph.edges()) parts.union(edge.a, edge.b)
  return parts.setCount
}

function requireRouter(topology: Topology, id: NodeId): void {
  if (!topology.graph.hasNode(id)) throw new Error(`There is no router "${id}".`)
}

function requireLink(topology: Topology, id: EdgeId) {
  const edge = topology.graph.getEdge(id)
  if (edge === undefined) throw new Error(`There is no link "${id}".`)
  return edge
}

function requireValidFields(fields: LinkFields): void {
  const errors = linkFieldErrors(fields)
  if (errors.length > 0) throw new RangeError(errors.join(' '))
}
