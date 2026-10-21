import { describe, expect, it } from 'vitest'
import { bfs } from '../../src/algo/bfs.ts'
import { Graph } from '../../src/ds/Graph.ts'
import { Rng } from '../../src/sim/rng.ts'
import { Simulator } from '../../src/sim/Simulator.ts'
import { grid, line, ring } from '../../src/topology/presets.ts'
import {
  analyzeNetwork,
  BROADCAST_HOLD_MS,
  broadcastFrame,
  planBroadcast,
} from '../../src/ui/analysis.ts'

/** Reference part count: one BFS from every router not reached yet. */
function partsByBfs(graph: Graph): number {
  const seen = new Set<string>()
  let parts = 0
  for (const router of graph.nodes()) {
    if (seen.has(router)) continue
    parts++
    for (const [node, hops] of bfs(graph, router).hops) if (hops < Infinity) seen.add(node)
  }
  return parts
}

describe('analyzeNetwork', () => {
  it('finds no weak spots in a grid, and a spanning tree of V - 1 links', () => {
    const analysis = analyzeNetwork(grid(3, 3).graph)
    expect(analysis).toMatchObject({ mstCost: 8, parts: 1, bridges: [], articulationPoints: [] })
    expect(analysis.mstLinks.length).toBe(8)
  })

  it('in a line every link is a bridge and every inner router a cut point', () => {
    expect(analyzeNetwork(line(4).graph)).toEqual({
      mstLinks: ['R0-R1', 'R1-R2', 'R2-R3'],
      mstCost: 3,
      parts: 1,
      bridges: ['R0-R1', 'R1-R2', 'R2-R3'],
      articulationPoints: ['R1', 'R2'],
    })
  })

  it('changes as links are cut in a running simulation', () => {
    const sim = new Simulator(ring(5).graph, { packetsPerSecond: 0, statsIntervalMs: 0 })
    expect(analyzeNetwork(sim.graph).bridges).toEqual([]) // a ring has two ways round
    const before = sim.linkChangeCount
    sim.schedule(0, { type: 'LINK_DOWN', linkId: 'R0-R1' })
    sim.runUntil(0)
    expect(sim.linkChangeCount).toBe(before + 1)
    // Now a line R1 - R2 - R3 - R4 - R0: every link left is a bridge.
    expect(analyzeNetwork(sim.graph)).toMatchObject({
      bridges: ['R1-R2', 'R2-R3', 'R3-R4', 'R4-R0'],
      articulationPoints: ['R2', 'R3', 'R4'],
      mstCost: 4,
      parts: 1,
    })
    sim.schedule(1, { type: 'LINK_DOWN', linkId: 'R2-R3' })
    sim.runUntil(1)
    expect(analyzeNetwork(sim.graph).parts).toBe(2)
  })

  it('counts parts like BFS and finds bridges like "remove it and look", on random graphs', () => {
    const rng = new Rng(1357)
    for (let trial = 0; trial < 40; trial++) {
      const n = rng.randomInt(1, 12)
      const graph = new Graph()
      for (let i = 0; i < n; i++) graph.addNode(`r${i}`)
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          if (rng.uniform() < 0.25) {
            graph.addEdge(`r${a}`, `r${b}`, { cost: rng.randomInt(1, 9), up: rng.uniform() > 0.2 })
          }
        }
      }
      const analysis = analyzeNetwork(graph)
      expect(analysis.parts).toBe(partsByBfs(graph))
      const bridges = graph
        .edges()
        .filter((edge) => {
          if (!edge.up) return false
          const without = graph.clone()
          without.setEdgeUp(edge.id, false)
          return partsByBfs(without) > partsByBfs(graph)
        })
        .map((edge) => edge.id)
      expect([...analysis.bridges].sort()).toEqual(bridges.sort())
    }
  })
})

describe('broadcast demo', () => {
  it('plans the MST broadcast and flooding, and plays on the simulation clock', () => {
    const graph = grid(3, 3).graph // 9 routers, 12 links
    const demo = planBroadcast(graph, 'R4', 1_000, 'tree')
    expect(demo.tree.messages.length).toBe(9 - 1)
    expect(demo.tree.duplicates).toBe(0)
    expect(demo.flood.messages.length).toBe(2 * 12 - 9 + 1)
    expect(demo.flood.duplicates).toBe(demo.flood.messages.length - (9 - 1))

    expect(broadcastFrame(demo, 999)).toBeNull() // not started yet
    expect(broadcastFrame(demo, 1_000)).toMatchObject({
      elapsedMs: 0,
      messages: demo.tree.messages,
    })
    const last = Math.max(...demo.tree.messages.map((m) => m.arriveAt))
    expect(broadcastFrame(demo, 1_000 + last + BROADCAST_HOLD_MS)).not.toBeNull()
    expect(broadcastFrame(demo, 1_000 + last + BROADCAST_HOLD_MS + 1)).toBeNull() // finished
    const flooding = broadcastFrame({ ...demo, shown: 'flood' }, 1_001)
    expect(flooding?.messages).toBe(demo.flood.messages)
  })

  it('leaves out links that are down', () => {
    const graph = line(3).graph
    graph.setEdgeUp('R1-R2', false)
    const demo = planBroadcast(graph, 'R0', 0, 'tree')
    expect([...demo.tree.reached.keys()]).toEqual(['R0', 'R1'])
    expect(demo.flood.reached.size).toBe(2)
  })
})
