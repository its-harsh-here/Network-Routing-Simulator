import { describe, expect, it } from 'vitest'
import { bfs, isConnected } from '../../src/algo/bfs.ts'
import { Graph, type NodeId } from '../../src/ds/Graph.ts'
import { Rng } from '../../src/sim/rng.ts'
import { arcsOf, distProblems, floydWarshall, randomGraph, sampleGraph } from './helpers.ts'

describe('bfs', () => {
  it('counts hops in the sample graph, ignoring costs', () => {
    const { hops, parent } = bfs(sampleGraph(), 'A')
    expect(Object.fromEntries(hops)).toEqual({ A: 0, B: 1, C: 1, D: 2, E: 3, F: Infinity })
    expect(Object.fromEntries(parent)).toEqual({ B: 'A', C: 'A', D: 'B', E: 'D' })
  })

  it('ignores links that are down', () => {
    const graph = sampleGraph()
    graph.setEdgeUp('ab', false)
    const { hops, parent } = bfs(graph, 'A')
    expect(Object.fromEntries(hops)).toEqual({ A: 0, B: 2, C: 1, D: 2, E: 3, F: Infinity })
    expect(parent.get('B')).toBe('C')
  })

  it('handles a source with no links', () => {
    const { hops, parent } = bfs(sampleGraph(), 'F')
    expect(hops.get('F')).toBe(0)
    expect(hops.get('A')).toBe(Infinity)
    expect(parent.size).toBe(0)
  })

  it('throws for an unknown source', () => {
    expect(() => bfs(sampleGraph(), 'Z')).toThrow('unknown source node')
  })
})

describe('isConnected', () => {
  it('is false while the sample graph has the isolated node F', () => {
    const graph = sampleGraph()
    expect(isConnected(graph)).toBe(false)
    graph.removeNode('F')
    expect(isConnected(graph)).toBe(true)
  })

  it('is false when cutting a link splits the graph', () => {
    const graph = sampleGraph()
    graph.removeNode('F')
    graph.setEdgeUp('de', false)
    expect(isConnected(graph)).toBe(false)
  })

  it('treats graphs with zero or one node as connected', () => {
    const graph = new Graph()
    expect(isConnected(graph)).toBe(true)
    graph.addNode('A')
    expect(isConnected(graph)).toBe(true)
  })

  it('is false for two nodes joined only by a down link', () => {
    const graph = new Graph()
    graph.addNode('A')
    graph.addNode('B')
    graph.addEdge('A', 'B', { up: false })
    expect(isConnected(graph)).toBe(false)
  })
})

describe('randomized: bfs vs Floyd-Warshall with unit costs', () => {
  it('agrees on 200 random graphs', () => {
    const rng = new Rng(77)
    for (let trial = 0; trial < 200; trial++) {
      const graph = randomGraph(rng, 5, 40)
      const hopCounts = floydWarshall(graph.nodes(), arcsOf(graph, true))
      const everyPairReachable = [...hopCounts.values()].every((row) =>
        [...row.values()].every((h) => h < Infinity),
      )
      expect(isConnected(graph)).toBe(everyPairReachable)

      const problems: string[] = []
      for (const source of graph.nodes()) {
        const { hops, parent } = bfs(graph, source)
        const expected = hopCounts.get(source) as Map<NodeId, number>
        problems.push(...distProblems(`hops from ${source}`, hops, expected))
        for (const [node, before] of parent) {
          const linkUp = graph.edgeBetween(before, node)?.up === true
          if (!linkUp || hops.get(before) !== (hops.get(node) as number) - 1) {
            problems.push(`from ${source}: ${before} cannot be the parent of ${node}`)
          }
        }
      }
      expect(problems).toEqual([])
    }
  })
})
