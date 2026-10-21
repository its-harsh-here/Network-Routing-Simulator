// Shared fixtures and slow-but-obvious reference implementations for the algorithm tests.
import type { Arc } from '../../src/algo/bellmanFord.ts'
import { Graph, type NodeId } from '../../src/ds/Graph.ts'
import type { Rng } from '../../src/sim/rng.ts'

/**
 * Hand-made graph with known answers. F has no links.
 *
 *     A --4-- B
 *     |     / |
 *     1   2   1
 *     | /     |
 *     C --5-- D --3-- E        F
 *
 * From A: C = 1, B = 3 (A-C-B), D = 4 (A-C-B-D), E = 7, F unreachable.
 */
export function sampleGraph(): Graph {
  const graph = new Graph()
  for (const node of ['A', 'B', 'C', 'D', 'E', 'F']) graph.addNode(node)
  graph.addEdge('A', 'B', { id: 'ab', cost: 4 })
  graph.addEdge('A', 'C', { id: 'ac', cost: 1 })
  graph.addEdge('B', 'C', { id: 'bc', cost: 2 })
  graph.addEdge('B', 'D', { id: 'bd', cost: 1 })
  graph.addEdge('C', 'D', { id: 'cd', cost: 5 })
  graph.addEdge('D', 'E', { id: 'de', cost: 3 })
  return graph
}

/**
 * Random graph with between minNodes and maxNodes nodes, named n0, n1, ...
 * Each graph picks its own edge density up to maxDensity, so sparse graphs are often
 * disconnected. Costs are integers from 1 to 20, so floating-point rounding never matters.
 * About 15% of links are down.
 */
export function randomGraph(
  rng: Rng,
  minNodes: number,
  maxNodes: number,
  maxDensity = 0.33,
): Graph {
  const graph = new Graph()
  const n = rng.randomInt(minNodes, maxNodes)
  for (let i = 0; i < n; i++) graph.addNode(`n${i}`)
  const density = 0.03 + rng.uniform() * (maxDensity - 0.03)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (rng.uniform() < density) {
        graph.addEdge(`n${i}`, `n${j}`, { cost: rng.randomInt(1, 20), up: rng.uniform() >= 0.15 })
      }
    }
  }
  return graph
}

/**
 * Differences between two distance maps, as readable messages. Empty means they match.
 * The randomized tests collect messages like this and make one expect() per graph, because
 * hundreds of thousands of separate expect() calls would make them several times slower.
 */
export function distProblems(
  label: string,
  actual: ReadonlyMap<NodeId, number>,
  expected: ReadonlyMap<NodeId, number>,
): string[] {
  const problems: string[] = []
  if (actual.size !== expected.size) {
    problems.push(`${label}: has ${actual.size} nodes, expected ${expected.size}`)
  }
  for (const [node, want] of expected) {
    const got = actual.get(node)
    if (got !== want) problems.push(`${label}: ${node} is ${got}, expected ${want}`)
  }
  return problems
}

/** Both directions of every link that is up. With unitCost, every arc costs 1 (hop counts). */
export function arcsOf(graph: Graph, unitCost = false): Arc[] {
  const arcs: Arc[] = []
  for (const edge of graph.edges()) {
    if (!edge.up) continue
    const cost = unitCost ? 1 : edge.cost
    arcs.push({ from: edge.a, to: edge.b, cost }, { from: edge.b, to: edge.a, cost })
  }
  return arcs
}

/**
 * Reference: all-pairs cheapest path costs by Floyd-Warshall, O(V^3). Allowing paths through
 * nodes 0..k, the best i -> j path either avoids k or goes i -> k -> j.
 * With negative cycles, a node on one ends up with a negative distance to itself.
 */
export function floydWarshall(nodes: NodeId[], arcs: Arc[]): Map<NodeId, Map<NodeId, number>> {
  const n = nodes.length
  const index = new Map(nodes.map((node, i) => [node, i]))
  const d = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 0 : Infinity)),
  )
  for (const { from, to, cost } of arcs) {
    const i = index.get(from) as number
    const j = index.get(to) as number
    d[i][j] = Math.min(d[i][j], cost)
  }
  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (d[i][k] + d[k][j] < d[i][j]) d[i][j] = d[i][k] + d[k][j]
      }
    }
  }
  return new Map(nodes.map((node, i) => [node, new Map(nodes.map((other, j) => [other, d[i][j]]))]))
}

/** Reference: every node reachable from `start` over up links, by a plain stack-based search. */
export function reachableFrom(graph: Graph, start: NodeId): Set<NodeId> {
  const seen = new Set([start])
  const stack = [start]
  while (stack.length > 0) {
    const node = stack.pop() as NodeId
    for (const { node: next } of graph.neighbors(node, { onlyUp: true })) {
      if (!seen.has(next)) {
        seen.add(next)
        stack.push(next)
      }
    }
  }
  return seen
}

/** Reference: number of connected components over up links (isolated nodes count as one each). */
export function componentCount(graph: Graph): number {
  const seen = new Set<NodeId>()
  let count = 0
  for (const node of graph.nodes()) {
    if (seen.has(node)) continue
    count++
    for (const reached of reachableFrom(graph, node)) seen.add(reached)
  }
  return count
}
