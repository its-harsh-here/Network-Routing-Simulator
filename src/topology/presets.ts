import { kruskalMST } from '../algo/kruskal.ts'
import { Graph, type Edge, type NodeId } from '../ds/Graph.ts'
import { Rng } from '../sim/rng.ts'

/** The preset topologies, by name. */
export const PRESET_NAMES = ['line', 'ring', 'star', 'grid', 'mesh', 'count-to-infinity'] as const
export type PresetName = (typeof PRESET_NAMES)[number]

/** A position for drawing, with x and y from 0 (left/top) to 1 (right/bottom). */
export interface Point {
  x: number
  y: number
}

/** A graph plus where to draw each router. */
export interface Topology {
  /** Short description, such as "grid 5x5". */
  name: string
  graph: Graph
  positions: Record<NodeId, Point>
}

/** Link settings for a preset. Anything left out comes from PRESET_LINK. */
export interface LinkSettings {
  cost?: number
  bandwidthBps?: number
  delayMs?: number
}

/** Default links: hop-count cost, 10 Mbps, 2 ms. */
export const PRESET_LINK = { cost: 1, bandwidthBps: 10_000_000, delayMs: 2 } as const

/** Router names are R0, R1, ... in creation order. */
const routerName = (i: number): NodeId => `R${i}`

/** Builds a topology from points and index pairs; each link's id is "Ra-Rb". O(V + E). */
function build(
  name: string,
  points: Point[],
  pairs: [number, number][],
  link: LinkSettings,
): Topology {
  const graph = new Graph()
  const positions: Record<NodeId, Point> = {}
  points.forEach((point, i) => {
    graph.addNode(routerName(i))
    positions[routerName(i)] = point
  })
  for (const [i, j] of pairs) {
    const a = routerName(i)
    const b = routerName(j)
    graph.addEdge(a, b, { id: `${a}-${b}`, ...PRESET_LINK, ...link })
  }
  return { name, graph, positions }
}

function requireCount(name: string, value: number, min: number): void {
  if (!Number.isInteger(value) || value < min) {
    throw new RangeError(`${name} must be an integer >= ${min}, got ${value}`)
  }
}

/** `n` points evenly spaced around a circle of radius 0.4, starting at the top. O(n). */
function circle(n: number): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
    return { x: 0.5 + 0.4 * Math.cos(angle), y: 0.5 + 0.4 * Math.sin(angle) }
  })
}

/**
 * R0 - R1 - ... - R(n-1), drawn left to right. Every link is a single point of failure.
 * Time: O(n).
 * @throws RangeError if n is not an integer >= 1.
 */
export function line(n: number, link: LinkSettings = {}): Topology {
  requireCount('line size', n, 1)
  const points = Array.from({ length: n }, (_, i) => ({
    x: n === 1 ? 0.5 : 0.1 + (0.8 * i) / (n - 1),
    y: 0.5,
  }))
  const pairs = Array.from({ length: n - 1 }, (_, i): [number, number] => [i, i + 1])
  return build(`line ${n}`, points, pairs, link)
}

/**
 * A line closed into a circle: R(n-1) links back to R0, so every pair of routers has two
 * disjoint paths and any one link can fail without disconnecting anything.
 * Time: O(n).
 * @throws RangeError if n is not an integer >= 3.
 */
export function ring(n: number, link: LinkSettings = {}): Topology {
  requireCount('ring size', n, 3)
  const pairs = Array.from({ length: n }, (_, i): [number, number] => [i, (i + 1) % n])
  return build(`ring ${n}`, circle(n), pairs, link)
}

/**
 * Hub R0 in the middle linked to n - 1 leaves on a circle. The hub is an articulation point.
 * Time: O(n).
 * @throws RangeError if n is not an integer >= 2.
 */
export function star(n: number, link: LinkSettings = {}): Topology {
  requireCount('star size', n, 2)
  const points = [{ x: 0.5, y: 0.5 }, ...circle(n - 1)]
  const pairs = Array.from({ length: n - 1 }, (_, i): [number, number] => [0, i + 1])
  return build(`star ${n}`, points, pairs, link)
}

/**
 * rows x cols lattice; each router links to its right and lower neighbours. Routers are
 * numbered row by row, so R(r * cols + c) is at row r, column c.
 * Time: O(rows * cols).
 * @throws RangeError if rows or cols is not an integer >= 1.
 */
export function grid(rows: number, cols: number, link: LinkSettings = {}): Topology {
  requireCount('grid rows', rows, 1)
  requireCount('grid cols', cols, 1)
  const spread = (i: number, count: number) => (count === 1 ? 0.5 : 0.1 + (0.8 * i) / (count - 1))
  const points: Point[] = []
  const pairs: [number, number][] = []
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      points.push({ x: spread(c, cols), y: spread(r, rows) })
      if (c + 1 < cols) pairs.push([i, i + 1])
      if (r + 1 < rows) pairs.push([i, i + cols])
    }
  }
  return build(`grid ${rows}x${cols}`, points, pairs, link)
}

/**
 * Seeded random connected network of `n` routers at random positions.
 * 0. Positions are random, but each new router is re-drawn (up to 30 times) while it lands
 *    closer than 0.5 / sqrt(n) to one already placed, so routers do not sit on top of each other.
 * 1. Kruskal's MST of the complete graph, weighted by distance, connects everything with short
 *    links.
 * 2. Each remaining pair is then linked with probability `p`, for redundancy.
 * Delay grows with distance (1 ms plus up to about 20 ms across the whole area), and the cost is
 * the delay in 5 ms steps (at least 1), so routing prefers fast paths while path costs stay
 * well under distance-vector's limit of 16. Settings in `link` override both.
 * The same n, p and seed always give the same network.
 * Time: O(n^2 log n) for the MST of the complete graph.
 * @throws RangeError if n is not an integer >= 1 or p is not in [0, 1].
 */
export function mesh(n: number, p: number, seed = 1, link: LinkSettings = {}): Topology {
  requireCount('mesh size', n, 1)
  if (!(p >= 0 && p <= 1)) throw new RangeError(`mesh p must be in [0, 1], got ${p}`)
  const rng = new Rng(seed)
  const spacing = 0.5 / Math.sqrt(n)
  const randomPoint = () => ({ x: rng.uniform(0.05, 0.95), y: rng.uniform(0.05, 0.95) })
  const points: Point[] = []
  for (let i = 0; i < n; i++) {
    const tooClose = (point: Point) =>
      points.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < spacing)
    let point = randomPoint()
    for (let attempt = 0; attempt < 30 && tooClose(point); attempt++) point = randomPoint()
    points.push(point)
  }
  const distance = (i: number, j: number) =>
    Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y)

  // Complete graph weighted by distance; the tiny minimum keeps the cost > 0 if two points meet.
  const complete = new Graph()
  for (let i = 0; i < n; i++) complete.addNode(routerName(i))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      complete.addEdge(routerName(i), routerName(j), { cost: Math.max(distance(i, j), 1e-9) })
    }
  }
  const indexOf = new Map(points.map((_, i) => [routerName(i), i]))
  const pairs: [number, number][] = kruskalMST(complete).map((edge) => {
    const i = indexOf.get(edge.a) as number
    const j = indexOf.get(edge.b) as number
    return i < j ? [i, j] : [j, i]
  })
  const inTree = new Set(pairs.map(([i, j]) => `${i}-${j}`))
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (!inTree.has(`${i}-${j}`) && rng.uniform() < p) pairs.push([i, j])
    }
  }

  const topology = build(`mesh ${n} (p=${p}, seed=${seed})`, points, [], {})
  for (const [i, j] of pairs) {
    const delayMs = Math.round((1 + 20 * distance(i, j)) * 10) / 10
    const a = routerName(i)
    const b = routerName(j)
    topology.graph.addEdge(a, b, {
      id: `${a}-${b}`,
      bandwidthBps: PRESET_LINK.bandwidthBps,
      delayMs,
      cost: Math.max(1, Math.round(delayMs / 5)),
      ...link,
    })
  }
  return topology
}

/**
 * Returns a copy of `topology` whose links have the settings returned by `change(edge)`, for
 * example every link made slower. Ids, endpoints, positions and up/down state are kept, and
 * anything `change` leaves out stays as it was.
 * Time: O(V + E).
 */
export function mapLinks(topology: Topology, change: (edge: Edge) => LinkSettings): Topology {
  const graph = new Graph()
  for (const node of topology.graph.nodes()) graph.addNode(node)
  for (const edge of topology.graph.edges()) {
    const { a, b, ...settings } = edge
    graph.addEdge(a, b, { ...settings, ...change(edge) })
  }
  return { name: topology.name, graph, positions: { ...topology.positions } }
}

/**
 * The classic count-to-infinity example: the line A - B - C. Under distance-vector without split
 * horizon, cutting B-C makes A and B count their cost to C up to 16, while packets for C loop
 * between them until their TTL runs out.
 * Time: O(1).
 */
export function countToInfinity(link: LinkSettings = {}): Topology {
  const graph = new Graph()
  const names = ['A', 'B', 'C']
  const positions: Record<NodeId, Point> = {}
  names.forEach((name, i) => {
    graph.addNode(name)
    positions[name] = { x: 0.15 + 0.35 * i, y: 0.5 }
  })
  graph.addEdge('A', 'B', { id: 'A-B', ...PRESET_LINK, ...link })
  graph.addEdge('B', 'C', { id: 'B-C', ...PRESET_LINK, ...link })
  return { name: 'count to infinity (A-B-C)', graph, positions }
}
