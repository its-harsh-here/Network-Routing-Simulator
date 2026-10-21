import { describe, expect, it } from 'vitest'
import { findBridgesAndArticulationPoints } from '../../src/algo/tarjan.ts'
import { Graph } from '../../src/ds/Graph.ts'
import { Rng } from '../../src/sim/rng.ts'
import { componentCount, randomGraph, reachableFrom } from './helpers.ts'

/** Builds a graph from "a-b" pairs; each edge's id is the pair itself. */
function graphFrom(nodes: string[], links: string[]): Graph {
  const graph = new Graph()
  for (const node of nodes) graph.addNode(node)
  for (const link of links) {
    const [a, b] = link.split('-')
    graph.addEdge(a, b, { id: link })
  }
  return graph
}

/** Runs the algorithm and returns sorted bridge ids and articulation points. */
function analyse(graph: Graph): { bridges: string[]; articulationPoints: string[] } {
  const result = findBridgesAndArticulationPoints(graph)
  return {
    bridges: result.bridges.map((edge) => edge.id).sort(),
    articulationPoints: [...result.articulationPoints].sort(),
  }
}

describe('findBridgesAndArticulationPoints', () => {
  it('finds the bridge between two triangles', () => {
    const graph = graphFrom(
      ['A', 'B', 'C', 'D', 'E', 'F'],
      ['A-B', 'B-C', 'C-A', 'C-D', 'D-E', 'E-F', 'F-D'],
    )
    expect(analyse(graph)).toEqual({ bridges: ['C-D'], articulationPoints: ['C', 'D'] })
  })

  it('on a path, every link is a bridge and every inner node is an articulation point', () => {
    const graph = graphFrom(['A', 'B', 'C', 'D'], ['A-B', 'B-C', 'C-D'])
    expect(analyse(graph)).toEqual({
      bridges: ['A-B', 'B-C', 'C-D'],
      articulationPoints: ['B', 'C'],
    })
  })

  it('finds the centre of a star whether or not the DFS starts there', () => {
    const centreFirst = graphFrom(['S', 'X', 'Y', 'Z'], ['S-X', 'S-Y', 'S-Z'])
    const leafFirst = graphFrom(['X', 'S', 'Y', 'Z'], ['S-X', 'S-Y', 'S-Z'])
    for (const graph of [centreFirst, leafFirst]) {
      expect(analyse(graph)).toEqual({
        bridges: ['S-X', 'S-Y', 'S-Z'],
        articulationPoints: ['S'],
      })
    }
  })

  it('finds nothing in a cycle', () => {
    const graph = graphFrom(['A', 'B', 'C', 'D'], ['A-B', 'B-C', 'C-D', 'D-A'])
    expect(analyse(graph)).toEqual({ bridges: [], articulationPoints: [] })
  })

  it('treats a cycle with one link down as a path', () => {
    const graph = graphFrom(['A', 'B', 'C', 'D'], ['A-B', 'B-C', 'C-D', 'D-A'])
    graph.setEdgeUp('D-A', false)
    expect(analyse(graph)).toEqual({
      bridges: ['A-B', 'B-C', 'C-D'],
      articulationPoints: ['B', 'C'],
    })
  })

  it('handles several components, isolated nodes and the empty graph', () => {
    const graph = graphFrom(['A', 'B', 'C', 'P', 'Q', 'Lonely'], ['A-B', 'B-C', 'P-Q'])
    expect(analyse(graph)).toEqual({ bridges: ['A-B', 'B-C', 'P-Q'], articulationPoints: ['B'] })
    expect(analyse(new Graph())).toEqual({ bridges: [], articulationPoints: [] })
  })

  it('handles a 20,000-node path without overflowing the stack', () => {
    const n = 20_000
    const graph = new Graph()
    for (let i = 0; i < n; i++) graph.addNode(`n${i}`)
    for (let i = 0; i + 1 < n; i++) graph.addEdge(`n${i}`, `n${i + 1}`)
    const result = findBridgesAndArticulationPoints(graph)
    expect(result.bridges.length).toBe(n - 1)
    expect(result.articulationPoints.length).toBe(n - 2)

    // Closing the path into a cycle removes every bridge and articulation point.
    graph.addEdge(`n${n - 1}`, 'n0')
    const cycle = findBridgesAndArticulationPoints(graph)
    expect(cycle.bridges).toEqual([])
    expect(cycle.articulationPoints).toEqual([])
  })

  describe('randomized', () => {
    it('matches "remove it and check connectivity" on 200 random graphs', () => {
      const rng = new Rng(1234)
      for (let trial = 0; trial < 200; trial++) {
        const graph = randomGraph(rng, 5, 40)

        // A link is a bridge if, once it is cut, its two ends can no longer reach each other.
        // Cutting (setting it down) and restoring it is much cheaper than cloning the graph.
        const expectedBridges: string[] = []
        for (const edge of graph.edges()) {
          if (!edge.up) continue
          graph.setEdgeUp(edge.id, false)
          if (!reachableFrom(graph, edge.a).has(edge.b)) expectedBridges.push(edge.id)
          graph.setEdgeUp(edge.id, true)
        }

        // A node is an articulation point if removing it leaves more components than before.
        const before = componentCount(graph)
        const expectedPoints: string[] = []
        for (const node of graph.nodes()) {
          const without = graph.clone()
          without.removeNode(node)
          if (componentCount(without) > before) expectedPoints.push(node)
        }

        expect(analyse(graph)).toEqual({
          bridges: expectedBridges.sort(),
          articulationPoints: expectedPoints.sort(),
        })
      }
    })
  })
})
