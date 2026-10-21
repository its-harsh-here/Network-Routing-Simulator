// Saving and loading topologies as JSON files, with validation that explains what is wrong.
import { Graph, type EdgeId, type NodeId } from '../ds/Graph.ts'
import { linkFieldErrors } from './edit.ts'
import type { Point, Topology } from './presets.ts'

/** Marks a file as one of ours, so loading some other JSON file fails with a clear message. */
export const TOPOLOGY_FORMAT = 'network-routing-simulator/topology'
/** The file version this code writes and reads. A change of format gets a new number. */
export const TOPOLOGY_VERSION = 1
/** Limits that keep a huge file from freezing the page. */
export const MAX_ROUTERS = 500
export const MAX_LINKS = 5_000
/** At most this many problems are listed; the rest are counted. */
const MAX_ERRORS = 8

export interface RouterRecord {
  id: NodeId
  x: number
  y: number
}

export interface LinkRecord {
  id: EdgeId
  a: NodeId
  b: NodeId
  cost: number
  bandwidthBps: number
  delayMs: number
}

/** What a topology file holds. Links are saved without their up/down state: all load up. */
export interface TopologyFile {
  format: typeof TOPOLOGY_FORMAT
  version: number
  name: string
  routers: RouterRecord[]
  links: LinkRecord[]
}

/** A topology read from a file, or the reasons it could not be read. */
export type ReadResult = { ok: true; topology: Topology } | { ok: false; errors: string[] }

/** The file form of a topology. Time: O(V + E). */
export function topologyToFile(topology: Topology): TopologyFile {
  return {
    format: TOPOLOGY_FORMAT,
    version: TOPOLOGY_VERSION,
    name: topology.name,
    routers: topology.graph.nodes().map((id) => {
      const { x, y } = topology.positions[id] ?? { x: 0, y: 0 }
      return { id, x, y }
    }),
    links: topology.graph.edges().map(({ id, a, b, cost, bandwidthBps, delayMs }) => ({
      id,
      a,
      b,
      cost,
      bandwidthBps,
      delayMs,
    })),
  }
}

/** The text of a topology file, indented for people to read. Time: O(V + E). */
export function serializeTopology(topology: Topology): string {
  return JSON.stringify(topologyToFile(topology), null, 2) + '\n'
}

/**
 * Reads the text of a topology file. A file without a name is called `defaultName`.
 * Time: O(text length + V + E).
 */
export function parseTopology(text: string, defaultName = 'custom'): ReadResult {
  if (text.trim() === '') return { ok: false, errors: ['The file is empty.'] }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { ok: false, errors: [`The file is not valid JSON: ${(error as Error).message}`] }
  }
  return readTopologyFile(value, defaultName)
}

/**
 * Checks parsed JSON against the file format and builds the topology. Every problem found is
 * reported, with where it is (such as "links[3] (R1-R9)"), up to a limit. A file without a name
 * is called `defaultName`. Time: O(V + E).
 */
export function readTopologyFile(value: unknown, defaultName = 'custom'): ReadResult {
  if (!isObject(value)) return fail(['The file must hold a JSON object, not a list or a value.'])
  if (value.format !== TOPOLOGY_FORMAT) {
    return fail([`This is not a topology file: "format" must be "${TOPOLOGY_FORMAT}".`])
  }
  if (value.version !== TOPOLOGY_VERSION) {
    return fail([
      `Unsupported version ${JSON.stringify(value.version)}: this app reads version ${TOPOLOGY_VERSION}.`,
    ])
  }
  const errors: string[] = []
  if (value.name !== undefined && typeof value.name !== 'string') {
    errors.push('"name" must be text.')
  }
  if (!Array.isArray(value.routers)) errors.push('"routers" must be a list.')
  if (!Array.isArray(value.links)) errors.push('"links" must be a list.')
  if (errors.length > 0) return fail(errors)
  const routers = value.routers as unknown[]
  const links = value.links as unknown[]
  if (routers.length > MAX_ROUTERS) {
    return fail([`The file has ${routers.length} routers; the limit is ${MAX_ROUTERS}.`])
  }
  if (links.length > MAX_LINKS) {
    return fail([`The file has ${links.length} links; the limit is ${MAX_LINKS}.`])
  }

  const graph = new Graph()
  const positions: Record<NodeId, Point> = {}
  for (const [i, router] of routers.entries()) {
    const at = `routers[${i}]`
    if (!isObject(router)) {
      errors.push(`${at} must be an object with "id", "x" and "y".`)
      continue
    }
    const { id, x, y } = router
    if (!isName(id)) {
      errors.push(`${at}: "id" must be a non-empty string.`)
      continue
    }
    if (graph.hasNode(id)) {
      errors.push(`${at} (${id}): another router has this id.`)
      continue
    }
    if (!isNumber(x) || !isNumber(y)) {
      errors.push(`${at} (${id}): "x" and "y" must be numbers.`)
      continue
    }
    graph.addNode(id)
    positions[id] = { x, y }
  }

  for (const [i, link] of links.entries()) {
    const problem = linkProblem(link, graph)
    if (problem !== null) {
      const id = isObject(link) && isName(link.id) ? ` (${link.id})` : ''
      errors.push(`links[${i}]${id}: ${problem}`)
      continue
    }
    // linkProblem has checked every field, so the record has the shape it should.
    const { id, a, b, cost, bandwidthBps, delayMs } = link as unknown as LinkRecord
    graph.addEdge(a, b, { id, cost, bandwidthBps, delayMs })
  }

  if (errors.length > 0) return fail(errors)
  const name = typeof value.name === 'string' && value.name.trim() !== '' ? value.name : defaultName
  return { ok: true, topology: { name, graph, positions } }
}

/**
 * What is wrong with one link record, given the routers and the links read so far, or null if
 * it is fine. Time: O(1).
 */
function linkProblem(link: unknown, graph: Graph): string | null {
  if (!isObject(link)) {
    return 'must be an object with "id", "a", "b", "cost", "bandwidthBps" and "delayMs".'
  }
  const { id, a, b, cost, bandwidthBps, delayMs } = link
  if (!isName(id)) return '"id" must be a non-empty string.'
  if (graph.getEdge(id) !== undefined) return 'another link has this id.'
  if (!isName(a) || !isName(b)) return '"a" and "b" must be router ids.'
  for (const end of [a, b]) {
    if (!graph.hasNode(end)) return `"${end}" is not a router in this file.`
  }
  if (a === b) return 'a link cannot join a router to itself.'
  const existing = graph.edgeBetween(a, b)
  if (existing !== undefined) return `${a} and ${b} are already joined by link "${existing.id}".`
  if (!isNumber(cost) || !isNumber(bandwidthBps) || !isNumber(delayMs)) {
    return '"cost", "bandwidthBps" and "delayMs" must be numbers.'
  }
  const problems = linkFieldErrors({ cost, bandwidthBps, delayMs })
  return problems.length > 0 ? problems.join(' ') : null
}

/** The first MAX_ERRORS problems, and a count of the rest. */
function fail(errors: string[]): ReadResult {
  if (errors.length <= MAX_ERRORS) return { ok: false, errors }
  const rest = errors.length - MAX_ERRORS
  return {
    ok: false,
    errors: [...errors.slice(0, MAX_ERRORS), `…and ${rest} more problem${rest === 1 ? '' : 's'}.`],
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isName(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== ''
}

function isNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
