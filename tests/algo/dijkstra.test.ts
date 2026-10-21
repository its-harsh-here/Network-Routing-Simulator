import { describe, expect, it } from 'vitest'
import { bellmanFord } from '../../src/algo/bellmanFord.ts'
import type { ShortestPaths } from '../../src/algo/common.ts'
import { buildForwardingTable, dijkstra, pathTo } from '../../src/algo/dijkstra.ts'
import { dijkstraNaive } from '../../src/algo/dijkstraNaive.ts'
import { Graph, type NodeId } from '../../src/ds/Graph.ts'
import { Rng } from '../../src/sim/rng.ts'
import { arcsOf, distProblems, floydWarshall, randomGraph, sampleGraph } from './helpers.ts'

/** Problems with `prev`: each reachable non-source node must follow an up edge on a cheapest path. */
function prevProblems(graph: Graph, source: NodeId, { dist, prev }: ShortestPaths): string[] {
  const problems: string[] = []
  for (const [node, d] of dist) {
    const before = prev.get(node)
    if (node === source || d === Infinity) {
      if (before !== undefined) problems.push(`${node} should have no prev`)
      continue
    }
    const edge = before === undefined ? undefined : graph.edgeBetween(before, node)
    if (edge === undefined || !edge.up) {
      problems.push(`${node}: prev ${before} is not joined to it by an up link`)
    } else if ((dist.get(before as NodeId) as number) + edge.cost !== d) {
      problems.push(`${node}: prev ${before} is not on a cheapest path`)
    }
  }
  return problems
}

/** Problems with pathTo: every reachable node's path must run from source over up links at cost dist. */
function pathProblems(graph: Graph, source: NodeId, { dist, prev }: ShortestPaths): string[] {
  const problems: string[] = []
  for (const [target, d] of dist) {
    if (d === Infinity) continue
    const path = pathTo(prev, target)
    if (path[0] !== source || path[path.length - 1] !== target) {
      problems.push(`${target}: path ${path.join('-')} has the wrong ends`)
      continue
    }
    let cost = 0
    for (let i = 0; i + 1 < path.length; i++) {
      const edge = graph.edgeBetween(path[i], path[i + 1])
      cost += edge?.up ? edge.cost : Infinity
    }
    if (cost !== d) problems.push(`${target}: path costs ${cost}, expected ${d}`)
  }
  return problems
}

/** Problems with a forwarding table, checked against all-pairs distances. */
function forwardingProblems(
  graph: Graph,
  source: NodeId,
  table: Map<NodeId, NodeId>,
  allPairs: Map<NodeId, Map<NodeId, number>>,
): string[] {
  const problems: string[] = []
  const fromSource = allPairs.get(source) as Map<NodeId, number>
  for (const [destination, d] of fromSource) {
    const hop = table.get(destination)
    if (destination === source || d === Infinity) {
      if (hop !== undefined) problems.push(`${destination} should not be in the table`)
      continue
    }
    const link = hop === undefined ? undefined : graph.edgeBetween(source, hop)
    if (link === undefined || !link.up) {
      problems.push(`${destination}: next hop ${hop} is not an up neighbour`)
    } else if (link.cost + (allPairs.get(hop as NodeId)?.get(destination) as number) !== d) {
      problems.push(`${destination}: next hop ${hop} is not on a cheapest path`)
    }
  }
  return problems
}

describe('dijkstra', () => {
  it('finds the cheapest paths in the sample graph', () => {
    const { dist, prev } = dijkstra(sampleGraph(), 'A')
    expect(Object.fromEntries(dist)).toEqual({ A: 0, B: 3, C: 1, D: 4, E: 7, F: Infinity })
    expect(Object.fromEntries(prev)).toEqual({ B: 'C', C: 'A', D: 'B', E: 'D' })
  })

  it('ignores links that are down', () => {
    const graph = sampleGraph()
    graph.setEdgeUp('bc', false)
    const { dist, prev } = dijkstra(graph, 'A')
    // Without B-C: B = 4 (direct), D = 5 (A-B-D beats A-C-D = 6), E = 8.
    expect(Object.fromEntries(dist)).toEqual({ A: 0, B: 4, C: 1, D: 5, E: 8, F: Infinity })
    expect(prev.get('D')).toBe('B')
  })

  it('handles a graph with one node', () => {
    const graph = new Graph()
    graph.addNode('X')
    const { dist, prev } = dijkstra(graph, 'X')
    expect(Object.fromEntries(dist)).toEqual({ X: 0 })
    expect(prev.size).toBe(0)
  })

  it('reaches nothing when every link is down', () => {
    const graph = sampleGraph()
    for (const edge of graph.edges()) graph.setEdgeUp(edge.id, false)
    const { dist, prev } = dijkstra(graph, 'A')
    expect([...dist.values()].filter((d) => d < Infinity)).toEqual([0])
    expect(prev.size).toBe(0)
  })

  it('picks one of several equal-cost paths', () => {
    const graph = new Graph()
    for (const node of ['S', 'L', 'R', 'T']) graph.addNode(node)
    graph.addEdge('S', 'L', { cost: 1 })
    graph.addEdge('S', 'R', { cost: 1 })
    graph.addEdge('L', 'T', { cost: 1 })
    graph.addEdge('R', 'T', { cost: 1 })
    const paths = dijkstra(graph, 'S')
    expect(paths.dist.get('T')).toBe(2)
    expect(['L', 'R']).toContain(paths.prev.get('T'))
    expect(prevProblems(graph, 'S', paths)).toEqual([])
  })

  it('throws for an unknown source', () => {
    expect(() => dijkstra(sampleGraph(), 'Z')).toThrow('unknown source node')
    expect(() => dijkstraNaive(sampleGraph(), 'Z')).toThrow('unknown source node')
    expect(() => buildForwardingTable(sampleGraph(), 'Z')).toThrow('unknown source node')
  })
})

describe('dijkstraNaive', () => {
  it('gives the same answers as dijkstra on the sample graph', () => {
    const graph = sampleGraph()
    for (const source of graph.nodes()) {
      const naive = dijkstraNaive(graph, source)
      expect(naive.dist).toEqual(dijkstra(graph, source).dist)
      expect(prevProblems(graph, source, naive)).toEqual([])
    }
  })
})

describe('pathTo', () => {
  it('rebuilds the path from the source', () => {
    const { prev } = dijkstra(sampleGraph(), 'A')
    expect(pathTo(prev, 'E')).toEqual(['A', 'C', 'B', 'D', 'E'])
    expect(pathTo(prev, 'C')).toEqual(['A', 'C'])
  })

  it('returns just the target when it has no predecessor', () => {
    const { prev } = dijkstra(sampleGraph(), 'A')
    expect(pathTo(prev, 'A')).toEqual(['A']) // the source
    expect(pathTo(prev, 'F')).toEqual(['F']) // unreachable: callers must check dist first
  })

  it('throws instead of looping forever when prev has a cycle', () => {
    const prev = new Map([
      ['x', 'y'],
      ['y', 'x'],
    ])
    expect(() => pathTo(prev, 'x')).toThrow('cycle')
  })
})

describe('buildForwardingTable', () => {
  it('sends every packet from A via C in the sample graph', () => {
    const table = buildForwardingTable(sampleGraph(), 'A')
    expect(Object.fromEntries(table)).toEqual({ B: 'C', C: 'C', D: 'C', E: 'C' })
  })

  it('reroutes when a link goes down', () => {
    const graph = sampleGraph()
    graph.setEdgeUp('bc', false)
    expect(Object.fromEntries(buildForwardingTable(graph, 'A'))).toEqual({
      B: 'B',
      C: 'C',
      D: 'B',
      E: 'B',
    })
  })

  it('works from a leaf router', () => {
    const table = buildForwardingTable(sampleGraph(), 'E')
    expect(Object.fromEntries(table)).toEqual({ A: 'D', B: 'D', C: 'D', D: 'D' })
  })

  it('is empty for a router with no up links', () => {
    expect(buildForwardingTable(sampleGraph(), 'F').size).toBe(0)
  })
})

describe('randomized: dijkstra, dijkstraNaive and bellmanFord vs Floyd-Warshall', () => {
  it('agree on 200 random graphs, including disconnected ones and links that are down', () => {
    const rng = new Rng(2025)
    let disconnectedGraphs = 0
    let graphsWithDownLinks = 0

    for (let trial = 0; trial < 200; trial++) {
      const graph = randomGraph(rng, 5, 40)
      const allPairs = floydWarshall(graph.nodes(), arcsOf(graph))
      if ([...allPairs.values()].some((row) => [...row.values()].includes(Infinity))) {
        disconnectedGraphs++
      }
      if (graph.edges().some((edge) => !edge.up)) graphsWithDownLinks++

      const problems: string[] = []
      for (const source of graph.nodes()) {
        const expected = allPairs.get(source) as Map<NodeId, number>
        const bellman = bellmanFord(graph, source)
        const results = {
          dijkstra: dijkstra(graph, source),
          dijkstraNaive: dijkstraNaive(graph, source),
          bellmanFord: bellman,
        }
        for (const [name, result] of Object.entries(results)) {
          const label = `${name} from ${source}`
          problems.push(...distProblems(label, result.dist, expected))
          problems.push(...prevProblems(graph, source, result).map((p) => `${label}: ${p}`))
        }
        if (bellman.hasNegativeCycle) problems.push(`bellmanFord from ${source}: negative cycle`)

        const label = `from ${source}`
        problems.push(...pathProblems(graph, source, results.dijkstra).map((p) => `${label}: ${p}`))
        const table = buildForwardingTable(graph, source)
        problems.push(
          ...forwardingProblems(graph, source, table, allPairs).map((p) => `${label}: ${p}`),
        )
      }
      expect(problems).toEqual([])
    }

    // Make sure the generator really produced the cases the test claims to cover.
    expect(disconnectedGraphs).toBeGreaterThan(20)
    expect(graphsWithDownLinks).toBeGreaterThan(100)
  })
})
