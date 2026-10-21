import { describe, expect, it } from 'vitest'
import { Rng } from '../../src/sim/rng.ts'
import {
  MAX_ROUTERS,
  parseTopology,
  readTopologyFile,
  serializeTopology,
  TOPOLOGY_FORMAT,
  topologyToFile,
  type TopologyFile,
} from '../../src/topology/json.ts'
import { grid, mesh, PRESET_NAMES, type Topology } from '../../src/topology/presets.ts'
import { buildLiveTopology } from '../../src/ui/simulation.ts'

function expectSameTopology(got: Topology, want: Topology) {
  expect(got.name).toBe(want.name)
  expect(got.graph.nodes()).toEqual(want.graph.nodes())
  expect(got.graph.edges()).toEqual(want.graph.edges())
  expect(got.positions).toEqual(want.positions)
}

function errorsOf(text: string): string[] {
  const result = parseTopology(text)
  if (result.ok) throw new Error('expected the file to be rejected')
  return result.errors
}

const fileText = (changes: Partial<Record<keyof TopologyFile, unknown>>) =>
  JSON.stringify({ ...topologyToFile(grid(2, 2)), ...changes })

describe('topology files', () => {
  it('round-trips every preset exactly', () => {
    for (const preset of PRESET_NAMES) {
      const topology = buildLiveTopology({ preset, size: 6, rows: 3, cols: 3, meshP: 0.2 }, 3)
      const result = parseTopology(serializeTopology(topology))
      if (!result.ok) throw new Error(result.errors.join('\n'))
      expectSameTopology(result.topology, topology)
    }
  })

  it('round-trips random meshes, with fractional positions and delays', () => {
    const rng = new Rng(808)
    for (let trial = 0; trial < 25; trial++) {
      const topology = mesh(rng.randomInt(2, 30), rng.uniform(0, 0.4), rng.randomInt(1, 1e6))
      const result = parseTopology(serializeTopology(topology))
      if (!result.ok) throw new Error(result.errors.join('\n'))
      expectSameTopology(result.topology, topology)
    }
  })

  it('saves links as up and without their state, and reads them back up', () => {
    const topology = grid(2, 2)
    topology.graph.setEdgeUp('R0-R1', false)
    const file = topologyToFile(topology)
    expect(file.links[0]).not.toHaveProperty('up')
    const result = readTopologyFile(JSON.parse(JSON.stringify(file)))
    expect(result.ok && result.topology.graph.getEdge('R0-R1')?.up).toBe(true)
  })

  it('explains files that are not topologies at all', () => {
    expect(errorsOf('')).toEqual(['The file is empty.'])
    expect(errorsOf('{"routers": [')[0]).toMatch(/^The file is not valid JSON: /)
    expect(errorsOf('[1, 2]')).toEqual(['The file must hold a JSON object, not a list or a value.'])
    expect(errorsOf('{"nodes": [], "edges": []}')).toEqual([
      `This is not a topology file: "format" must be "${TOPOLOGY_FORMAT}".`,
    ])
    expect(errorsOf(fileText({ version: 2 }))).toEqual([
      'Unsupported version 2: this app reads version 1.',
    ])
    expect(errorsOf(fileText({ routers: {}, links: 'none' }))).toEqual([
      '"routers" must be a list.',
      '"links" must be a list.',
    ])
  })

  it('names the router or link that is wrong, and what is wrong with it', () => {
    const routers = [
      { id: 'A', x: 0, y: 0 },
      { id: 'B', x: 1, y: 0 },
      { id: 'A', x: 2, y: 0 },
      { id: '', x: 0, y: 1 },
      { id: 'C', x: '1', y: 1 },
      7,
    ]
    const link = (id: string, a: string, b: string, more = {}) => ({
      id,
      a,
      b,
      cost: 1,
      bandwidthBps: 1e6,
      delayMs: 2,
      ...more,
    })
    const links = [
      link('A-B', 'A', 'B'),
      link('A-B', 'B', 'A'),
      link('B-A', 'B', 'A'),
      link('A-Z', 'A', 'Z'),
      link('A-A', 'A', 'A'),
      link('bad', 'A', 'B', { cost: 0, delayMs: -1 }),
      link('text', 'A', 'B', { bandwidthBps: '1 Mbps' }),
    ]
    expect(errorsOf(fileText({ routers, links }))).toEqual([
      'routers[2] (A): another router has this id.',
      'routers[3]: "id" must be a non-empty string.',
      'routers[4] (C): "x" and "y" must be numbers.',
      'routers[5] must be an object with "id", "x" and "y".',
      'links[1] (A-B): another link has this id.',
      'links[2] (B-A): B and A are already joined by link "A-B".',
      'links[3] (A-Z): "Z" is not a router in this file.',
      'links[4] (A-A): a link cannot join a router to itself.',
      '…and 2 more problems.',
    ])
    // The two cut off: invalid numbers and a non-number.
    expect(errorsOf(fileText({ routers: routers.slice(0, 2), links: links.slice(5) }))).toEqual([
      'links[0] (bad): Cost must be a number greater than 0. Delay must be a number of 0 or more.',
      'links[1] (text): "cost", "bandwidthBps" and "delayMs" must be numbers.',
    ])
  })

  it('refuses files above the size limits, and names unnamed networks "custom"', () => {
    const many = Array.from({ length: MAX_ROUTERS + 1 }, (_, i) => ({ id: `R${i}`, x: i, y: 0 }))
    expect(errorsOf(fileText({ routers: many, links: [] }))).toEqual([
      `The file has ${MAX_ROUTERS + 1} routers; the limit is ${MAX_ROUTERS}.`,
    ])
    const result = parseTopology(fileText({ name: undefined }))
    expect(result.ok && result.topology.name).toBe('custom')
    expect(errorsOf(fileText({ name: 5 }))).toEqual(['"name" must be text.'])
  })

  it('catches every single broken field of a valid file, naming where it is', () => {
    // Break one field of a valid file at random; reading must fail and point at that field.
    const rng = new Rng(77)
    const breakages: [string, (value: unknown) => unknown][] = [
      ['a string', () => 'oops'],
      ['null', () => null],
      ['a negative number', () => -5],
      ['a missing value', () => undefined],
    ]
    for (let trial = 0; trial < 300; trial++) {
      const file = topologyToFile(grid(3, 3)) as unknown as Record<
        string,
        Record<string, unknown>[]
      >
      const list = rng.pick(['routers', 'links'] as const)
      const index = rng.randomInt(0, file[list].length - 1)
      const fields =
        list === 'routers' ? ['id', 'x', 'y'] : ['id', 'a', 'b', 'cost', 'bandwidthBps']
      const field = rng.pick(fields)
      const [what, broken] = rng.pick(breakages)
      // Some changes are not breakages: a negative x or y is a fine position, and a different
      // string is just another id.
      if ((field === 'x' || field === 'y') && what === 'a negative number') continue
      if (field === 'id' && what === 'a string') continue
      file[list][index][field] = broken(file[list][index][field])
      const errors = errorsOf(JSON.stringify(file))
      const named = errors.some((e) => e.startsWith(`${list}[${index}]`))
      if (!named) throw new Error(`trial ${trial}: ${list}[${index}].${field} = ${what}: ${errors}`)
    }
  })
})
