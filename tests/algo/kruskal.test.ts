import { describe, expect, it } from 'vitest'
import { kruskalMST } from '../../src/algo/kruskal.ts'
import { Graph, type Edge, type NodeId } from '../../src/ds/Graph.ts'
import { Rng } from '../../src/sim/rng.ts'
import { componentCount, randomGraph, sampleGraph } from './helpers.ts'

const totalCost = (edges: Edge[]) => edges.reduce((sum, edge) => sum + edge.cost, 0)

/** Reference: true if `edges` has no cycle, using naive relabelling (no union-find tricks). */
function isAcyclic(nodes: NodeId[], edges: Edge[]): boolean {
  const label = new Map(nodes.map((node) => [node, node]))
  for (const { a, b } of edges) {
    const labelA = label.get(a)
    const labelB = label.get(b)
    if (labelA === labelB) return false
    for (const [node, l] of label) if (l === labelB) label.set(node, labelA as NodeId)
  }
  return true
}

/**
 * Reference: the cheapest spanning forest cost, by trying every set of V - c up links, where c
 * is the number of components. An acyclic set of exactly V - c links must span every component.
 */
function bruteForceForestCost(graph: Graph): number {
  const nodes = graph.nodes()
  const candidates = graph.edges().filter((edge) => edge.up)
  const needed = nodes.length - componentCount(graph)
  const chosen: Edge[] = []
  let best = Infinity

  const choose = (start: number) => {
    if (chosen.length === needed) {
      if (isAcyclic(nodes, chosen)) best = Math.min(best, totalCost(chosen))
      return
    }
    for (let i = start; i <= candidates.length - (needed - chosen.length); i++) {
      chosen.push(candidates[i])
      choose(i + 1)
      chosen.pop()
    }
  }
  choose(0)
  return best
}

/** Builds a graph with the same nodes and only the given edges, to count its components. */
function graphOf(nodes: NodeId[], edges: Edge[]): Graph {
  const graph = new Graph()
  for (const node of nodes) graph.addNode(node)
  for (const { a, b, ...options } of edges) graph.addEdge(a, b, options)
  return graph
}

describe('kruskalMST', () => {
  it('finds the minimum spanning forest of the sample graph', () => {
    const forest = kruskalMST(sampleGraph())
    // Cheapest first: ac (1), bd (1), bc (2), de (3). ab (4) and cd (5) would close cycles.
    expect(forest.map((edge) => edge.id)).toEqual(['ac', 'bd', 'bc', 'de'])
    expect(totalCost(forest)).toBe(7)
  })

  it('ignores links that are down', () => {
    const graph = sampleGraph()
    graph.setEdgeUp('bc', false)
    const forest = kruskalMST(graph)
    expect(forest.map((edge) => edge.id)).toEqual(['ac', 'bd', 'de', 'ab'])
    expect(totalCost(forest)).toBe(9)
  })

  it('returns one tree per component', () => {
    const graph = sampleGraph()
    graph.addNode('G')
    graph.addEdge('F', 'G', { id: 'fg', cost: 2 })
    const forest = kruskalMST(graph)
    expect(forest.map((edge) => edge.id).sort()).toEqual(['ac', 'bc', 'bd', 'de', 'fg'])
  })

  it('returns no edges for empty, single-node and all-down graphs', () => {
    expect(kruskalMST(new Graph())).toEqual([])
    const single = new Graph()
    single.addNode('A')
    expect(kruskalMST(single)).toEqual([])
    const allDown = sampleGraph()
    for (const edge of allDown.edges()) allDown.setEdgeUp(edge.id, false)
    expect(kruskalMST(allDown)).toEqual([])
  })

  it('breaks ties by the order edges were added', () => {
    const graph = new Graph()
    for (const node of ['A', 'B', 'C']) graph.addNode(node)
    graph.addEdge('A', 'B', { id: 'first', cost: 1 })
    graph.addEdge('B', 'C', { id: 'second', cost: 1 })
    graph.addEdge('A', 'C', { id: 'third', cost: 1 })
    expect(kruskalMST(graph).map((edge) => edge.id)).toEqual(['first', 'second'])
  })

  describe('randomized', () => {
    it('matches brute force on 200 random graphs with up to 7 nodes', () => {
      const rng = new Rng(8080)
      for (let trial = 0; trial < 200; trial++) {
        const graph = randomGraph(rng, 1, 7, 0.8)
        expect(totalCost(kruskalMST(graph))).toBe(bruteForceForestCost(graph))
      }
    })

    it('returns a spanning forest of up links on 200 random graphs with 5 to 40 nodes', () => {
      const rng = new Rng(9090)
      for (let trial = 0; trial < 200; trial++) {
        const graph = randomGraph(rng, 5, 40)
        const forest = kruskalMST(graph)
        const forestGraph = graphOf(graph.nodes(), forest)
        expect(forest.every((edge) => edge.up)).toBe(true)
        // A graph with V nodes and c components is a forest exactly when it has V - c edges.
        expect(forest.length).toBe(graph.nodeCount - componentCount(forestGraph))
        // Spanning: the forest connects exactly what the up links connect.
        expect(componentCount(forestGraph)).toBe(componentCount(graph))
      }
    })
  })
})
