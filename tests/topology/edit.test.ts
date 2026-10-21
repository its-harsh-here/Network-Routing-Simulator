import { describe, expect, it } from 'vitest'
import { bfs } from '../../src/algo/bfs.ts'
import { Rng } from '../../src/sim/rng.ts'
import {
  addLink,
  addRouter,
  cloneTopology,
  countParts,
  emptyTopology,
  linkFieldErrors,
  moveRouter,
  nextRouterId,
  removeLink,
  removeRouter,
  updateLink,
  withAllLinksUp,
} from '../../src/topology/edit.ts'
import { grid, line, type Topology } from '../../src/topology/presets.ts'

const LINK = { cost: 1, bandwidthBps: 200_000, delayMs: 100 }

/** Routers and links as plain sorted text, to compare topologies at a glance. */
function summary(topology: Topology) {
  return {
    routers: topology.graph.nodes().sort(),
    links: topology.graph
      .edges()
      .map((e) => `${e.id}:${e.a}-${e.b}:${e.cost}/${e.bandwidthBps}/${e.delayMs}/${e.up}`)
      .sort(),
  }
}

describe('topology editing', () => {
  it('builds a network from nothing, naming routers R0, R1, ...', () => {
    let topology = emptyTopology()
    const ids: string[] = []
    for (let i = 0; i < 3; i++) {
      const added = addRouter(topology, { x: i * 10, y: 5 })
      topology = added.topology
      ids.push(added.id)
    }
    expect(ids).toEqual(['R0', 'R1', 'R2'])
    expect(topology.positions.R2).toEqual({ x: 20, y: 5 })
    topology = addLink(topology, 'R0', 'R1', LINK).topology
    const { topology: linked, id } = addLink(topology, 'R2', 'R1', { ...LINK, cost: 4 })
    expect(id).toBe('R2-R1')
    expect(linked.graph.getEdge('R2-R1')).toMatchObject({ a: 'R2', b: 'R1', cost: 4, up: true })
    expect(countParts(linked)).toBe(1)
  })

  it('reuses the lowest free router name', () => {
    const topology = removeRouter(line(4), 'R1')
    expect(nextRouterId(topology)).toBe('R1')
    expect(addRouter(topology, { x: 0, y: 0 }).id).toBe('R1')
  })

  it('never changes the topology it was given', () => {
    const original = grid(2, 2)
    const before = summary(original)
    const positions = JSON.stringify(original.positions)
    addRouter(original, { x: 9, y: 9 })
    moveRouter(original, 'R0', { x: 5, y: 5 })
    removeRouter(original, 'R0')
    addLink(original, 'R0', 'R3', LINK)
    updateLink(original, 'R0-R1', { ...LINK, cost: 7 })
    removeLink(original, 'R0-R1')
    expect(summary(original)).toEqual(before)
    expect(JSON.stringify(original.positions)).toBe(positions)
  })

  it('removing a router removes its links', () => {
    const topology = removeRouter(grid(3, 3), 'R4') // the centre
    expect(topology.graph.nodeCount).toBe(8)
    expect(topology.graph.edgeCount).toBe(12 - 4)
    expect(topology.positions.R4).toBeUndefined()
  })

  it('updates a link in place, keeping its id, ends and state', () => {
    const cut = cloneTopology(line(3))
    cut.graph.setEdgeUp('R0-R1', false)
    const updated = updateLink(cut, 'R0-R1', { cost: 3, bandwidthBps: 1e6, delayMs: 0 })
    expect(updated.graph.getEdge('R0-R1')).toMatchObject({
      a: 'R0',
      b: 'R1',
      cost: 3,
      bandwidthBps: 1e6,
      delayMs: 0,
      up: false,
    })
    expect(withAllLinksUp(updated).graph.getEdge('R0-R1')?.up).toBe(true)
    expect(updated.graph.getEdge('R0-R1')?.up).toBe(false) // withAllLinksUp copies
  })

  it('rejects impossible edits with messages for the user', () => {
    const topology = line(3)
    expect(() => addLink(topology, 'R0', 'R0', LINK)).toThrow('cannot join a router to itself')
    expect(() => addLink(topology, 'R1', 'R0', LINK)).toThrow('R1 and R0 are already linked')
    expect(() => addLink(topology, 'R0', 'R9', LINK)).toThrow('There is no router "R9"')
    expect(() => updateLink(topology, 'nope', LINK)).toThrow('There is no link "nope"')
    expect(() => addLink(topology, 'R0', 'R2', { ...LINK, cost: 0 })).toThrow(RangeError)
    expect(linkFieldErrors({ cost: -1, bandwidthBps: NaN, delayMs: -0.5 })).toEqual([
      'Cost must be a number greater than 0.',
      'Bandwidth must be a number greater than 0.',
      'Delay must be a number of 0 or more.',
    ])
    expect(linkFieldErrors({ cost: 0.5, bandwidthBps: 1, delayMs: 0 })).toEqual([])
  })

  it('gives a link a fresh id if "a-b" is taken', () => {
    // Routers named so that two different pairs both spell "A-B-C".
    let topology = emptyTopology()
    for (const id of ['A', 'B-C', 'A-B', 'C']) {
      topology.graph.addNode(id)
      topology.positions[id] = { x: 0, y: 0 }
    }
    topology = addLink(topology, 'A', 'B-C', LINK).topology
    expect(addLink(topology, 'A-B', 'C', LINK).id).toBe('A-B-C#2')
  })

  it('matches a simple model under random edits, and counts parts like BFS does', () => {
    const rng = new Rng(4242)
    let topology = emptyTopology()
    const model = { routers: new Set<string>(), links: new Map<string, [string, string]>() }
    const problems: string[] = []
    for (let step = 0; step < 1_500; step++) {
      const routers = [...model.routers]
      const roll = rng.uniform()
      // Keep the network small (at most 25 routers) so it stays dense enough to be interesting.
      if (routers.length < 2 || (roll < 0.3 && routers.length < 25)) {
        const { topology: next, id } = addRouter(topology, { x: rng.uniform(), y: rng.uniform() })
        topology = next
        model.routers.add(id)
      } else if (roll < 0.7) {
        const a = rng.pick(routers)
        const b = rng.pick(routers)
        const linked = [...model.links.values()].some(
          ([x, y]) => (x === a && y === b) || (x === b && y === a),
        )
        if (a === b || linked) {
          expect(() => addLink(topology, a, b, LINK)).toThrow()
        } else {
          const { topology: next, id } = addLink(topology, a, b, LINK)
          topology = next
          model.links.set(id, [a, b])
        }
      } else if (roll < 0.85 && model.links.size > 0) {
        const id = rng.pick([...model.links.keys()])
        topology = removeLink(topology, id)
        model.links.delete(id)
      } else {
        const id = rng.pick(routers)
        topology = removeRouter(topology, id)
        model.routers.delete(id)
        for (const [link, [a, b]] of model.links) {
          if (a === id || b === id) model.links.delete(link)
        }
      }

      const { routers: gotRouters, links: gotLinks } = summary(topology)
      if (gotRouters.join() !== [...model.routers].sort().join())
        problems.push(`step ${step}: routers`)
      const wantLinks = [...model.links.keys()].sort().join()
      const linkIds = gotLinks.map((l) => l.split(':')[0]).sort()
      if (linkIds.join() !== wantLinks) problems.push(`step ${step}: links`)
      if (Object.keys(topology.positions).sort().join() !== [...model.routers].sort().join()) {
        problems.push(`step ${step}: positions`)
      }
      // Reference part count: start a BFS from every router not yet reached.
      const reached = new Set<string>()
      let parts = 0
      for (const router of model.routers) {
        if (reached.has(router)) continue
        parts++
        for (const [node, hops] of bfs(topology.graph, router).hops) {
          if (hops < Infinity) reached.add(node)
        }
      }
      if (countParts(topology) !== parts) problems.push(`step ${step}: parts`)
    }
    expect(problems).toEqual([])
    expect(topology.graph.nodeCount).toBeGreaterThan(5) // the walk really built something
  })
})
