import type { Edge, Graph } from '../ds/Graph.ts'
import { UnionFind } from '../ds/UnionFind.ts'

/**
 * Kruskal's minimum spanning forest over the links that are up: one minimum spanning tree per
 * connected component. Edges are tried from cheapest to most expensive, and an edge is kept
 * only if it joins two different components, which UnionFind checks. An edge inside a single
 * component would close a cycle, and it can be skipped because every edge already in that
 * component's tree costs no more than it does.
 *
 * Equal-cost edges are tried in the order they were added (Array.prototype.sort is stable),
 * so the result is deterministic.
 *
 * Time: O(E log E) = O(E log V) for the sort, plus O(E α(V)) for the union-find work.
 */
export function kruskalMST(graph: Graph): Edge[] {
  const candidates = graph.edges().filter((edge) => edge.up)
  candidates.sort((x, y) => x.cost - y.cost)

  const components = new UnionFind(graph.nodes())
  const forest: Edge[] = []
  for (const edge of candidates) {
    if (components.setCount === 1) break // already a single spanning tree
    if (components.union(edge.a, edge.b)) forest.push(edge)
  }
  return forest
}
