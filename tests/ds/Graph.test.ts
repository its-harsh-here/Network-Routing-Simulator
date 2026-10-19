import { describe, expect, it } from 'vitest'
import { DEFAULT_EDGE, Graph } from '../../src/ds/Graph.ts'
import { Rng } from '../../src/sim/rng.ts'

/** The path A - B - C (edges "ab" and "bc") plus an isolated node D. */
function pathGraph(): Graph {
  const graph = new Graph()
  for (const node of ['A', 'B', 'C', 'D']) graph.addNode(node)
  graph.addEdge('A', 'B', { id: 'ab', cost: 2 })
  graph.addEdge('B', 'C', { id: 'bc', cost: 3 })
  return graph
}

/** Neighbour ids of a node, sorted, so tests do not depend on insertion order. */
function neighborIds(graph: Graph, node: string, onlyUp = false): string[] {
  return graph
    .neighbors(node, { onlyUp })
    .map((neighbor) => neighbor.node)
    .sort()
}

describe('Graph', () => {
  describe('empty graph', () => {
    it('has no nodes or edges', () => {
      const graph = new Graph()
      expect(graph.nodeCount).toBe(0)
      expect(graph.edgeCount).toBe(0)
      expect(graph.nodes()).toEqual([])
      expect(graph.edges()).toEqual([])
      expect(graph.toJSON()).toEqual({ nodes: [], edges: [] })
      expect(graph.getEdge('e1')).toBeUndefined()
      expect(graph.edgeBetween('A', 'B')).toBeUndefined()
    })
  })

  describe('nodes', () => {
    it('adds nodes and rejects duplicates', () => {
      const graph = new Graph()
      expect(graph.addNode('A')).toBe(true)
      expect(graph.addNode('A')).toBe(false)
      expect(graph.hasNode('A')).toBe(true)
      expect(graph.hasNode('B')).toBe(false)
      expect(graph.nodeCount).toBe(1)
    })

    it('a node with no edges has no neighbours', () => {
      const graph = new Graph()
      graph.addNode('A')
      expect(graph.neighbors('A')).toEqual([])
    })

    it('lists nodes in the order they were added', () => {
      const graph = new Graph()
      for (const node of ['C', 'A', 'B']) graph.addNode(node)
      expect(graph.nodes()).toEqual(['C', 'A', 'B'])
    })

    it('removeNode removes the node and every edge touching it', () => {
      const graph = pathGraph()
      expect(graph.removeNode('B')).toBe(true)
      expect(graph.hasNode('B')).toBe(false)
      expect(graph.edgeCount).toBe(0)
      expect(graph.getEdge('ab')).toBeUndefined()
      expect(graph.neighbors('A')).toEqual([])
      expect(graph.neighbors('C')).toEqual([])
      expect(graph.removeNode('B')).toBe(false)
    })

    it('neighbors throws for an unknown node', () => {
      expect(() => new Graph().neighbors('X')).toThrow('unknown node')
    })
  })

  describe('edges', () => {
    it('fills in defaults and generates ids', () => {
      const graph = new Graph()
      graph.addNode('A')
      graph.addNode('B')
      graph.addNode('C')
      const first = graph.addEdge('A', 'B')
      const second = graph.addEdge('B', 'C')
      expect(first).toEqual({ id: 'e1', a: 'A', b: 'B', ...DEFAULT_EDGE })
      expect(second.id).toBe('e2')
    })

    it('uses the given settings', () => {
      const graph = new Graph()
      graph.addNode('A')
      graph.addNode('B')
      const edge = graph.addEdge('A', 'B', {
        id: 'link',
        cost: 5,
        bandwidthBps: 1_000,
        delayMs: 0,
        up: false,
      })
      expect(edge).toEqual({
        id: 'link',
        a: 'A',
        b: 'B',
        cost: 5,
        bandwidthBps: 1_000,
        delayMs: 0,
        up: false,
      })
    })

    it('skips generated ids that are already taken', () => {
      const graph = new Graph()
      for (const node of ['A', 'B', 'C']) graph.addNode(node)
      graph.addEdge('A', 'B', { id: 'e1' })
      expect(graph.addEdge('B', 'C').id).toBe('e2')
    })

    it('is undirected: the edge is found from either end', () => {
      const graph = pathGraph()
      const edge = graph.getEdge('ab')
      expect(edge).toBeDefined()
      expect(graph.edgeBetween('A', 'B')).toBe(edge)
      expect(graph.edgeBetween('B', 'A')).toBe(edge)
      expect(neighborIds(graph, 'A')).toEqual(['B'])
      expect(neighborIds(graph, 'B')).toEqual(['A', 'C'])
      expect(graph.edgeBetween('A', 'C')).toBeUndefined()
    })

    it('rejects edges to missing nodes, self-loops and duplicate pairs or ids', () => {
      const graph = pathGraph()
      expect(() => graph.addEdge('A', 'X')).toThrow('unknown node')
      expect(() => graph.addEdge('X', 'A')).toThrow('unknown node')
      expect(() => graph.addEdge('A', 'A')).toThrow('itself')
      expect(() => graph.addEdge('A', 'B')).toThrow('already joined')
      expect(() => graph.addEdge('B', 'A')).toThrow('already joined')
      expect(() => graph.addEdge('C', 'D', { id: 'ab' })).toThrow('already used')
      expect(graph.edgeCount).toBe(2)
    })

    it('rejects out-of-range numbers', () => {
      const graph = pathGraph()
      const bad = [
        { cost: 0 },
        { cost: -1 },
        { cost: NaN },
        { cost: Infinity },
        { bandwidthBps: 0 },
        { delayMs: -1 },
      ]
      for (const options of bad) {
        expect(() => graph.addEdge('C', 'D', options)).toThrow(RangeError)
      }
      expect(graph.edgeBetween('C', 'D')).toBeUndefined()
    })

    it('removeEdge removes it from both ends and returns false the second time', () => {
      const graph = pathGraph()
      expect(graph.removeEdge('ab')).toBe(true)
      expect(graph.getEdge('ab')).toBeUndefined()
      expect(graph.edgeBetween('A', 'B')).toBeUndefined()
      expect(graph.edgeBetween('B', 'A')).toBeUndefined()
      expect(neighborIds(graph, 'B')).toEqual(['C'])
      expect(graph.removeEdge('ab')).toBe(false)
      expect(graph.hasNode('A')).toBe(true)
    })

    it('lists edges in the order they were added', () => {
      expect(
        pathGraph()
          .edges()
          .map((edge) => edge.id),
      ).toEqual(['ab', 'bc'])
    })
  })

  describe('setEdgeUp', () => {
    it('cuts and restores a link, and onlyUp skips cut links', () => {
      const graph = pathGraph()
      const cut = graph.setEdgeUp('ab', false)
      expect(cut.up).toBe(false)
      expect(graph.getEdge('ab')?.up).toBe(false)
      expect(graph.edgeBetween('B', 'A')?.up).toBe(false)
      expect(neighborIds(graph, 'B')).toEqual(['A', 'C'])
      expect(neighborIds(graph, 'B', true)).toEqual(['C'])
      expect(neighborIds(graph, 'A', true)).toEqual([])

      graph.setEdgeUp('ab', true)
      expect(neighborIds(graph, 'A', true)).toEqual(['B'])
    })

    it('replaces the edge object instead of changing the old one', () => {
      const graph = pathGraph()
      const before = graph.getEdge('ab')
      graph.setEdgeUp('ab', false)
      expect(before?.up).toBe(true)
      expect(graph.edges().map((edge) => edge.id)).toEqual(['ab', 'bc'])
    })

    it('throws for an unknown edge', () => {
      expect(() => pathGraph().setEdgeUp('nope', false)).toThrow('unknown edge')
    })
  })

  describe('clone', () => {
    it('makes an independent copy', () => {
      const original = pathGraph()
      const copy = original.clone()
      expect(copy.toJSON()).toEqual(original.toJSON())

      copy.addNode('E')
      copy.removeEdge('ab')
      copy.setEdgeUp('bc', false)
      expect(original.hasNode('E')).toBe(false)
      expect(original.getEdge('ab')).toBeDefined()
      expect(original.getEdge('bc')?.up).toBe(true)

      original.removeNode('C')
      expect(copy.hasNode('C')).toBe(true)
    })

    it('continues generating ids from where the original was', () => {
      const original = new Graph()
      for (const node of ['A', 'B', 'C']) original.addNode(node)
      original.addEdge('A', 'B')
      original.removeEdge('e1')
      const copy = original.clone()
      expect(copy.addEdge('B', 'C').id).toBe('e2')
    })
  })

  describe('JSON', () => {
    it('round-trips through toJSON and fromJSON', () => {
      const original = pathGraph()
      original.setEdgeUp('bc', false)
      const restored = Graph.fromJSON(original.toJSON())
      expect(restored.toJSON()).toEqual(original.toJSON())
      expect(neighborIds(restored, 'B', true)).toEqual(['A'])
    })

    it('round-trips through a JSON string', () => {
      const original = pathGraph()
      const text = JSON.stringify(original)
      const restored = Graph.fromJSON(JSON.parse(text))
      expect(restored.toJSON()).toEqual(original.toJSON())
    })

    it('rejects invalid JSON graphs', () => {
      expect(() => Graph.fromJSON({ nodes: ['A', 'A'], edges: [] })).toThrow('duplicate node')
      const danglingEdge = { ...DEFAULT_EDGE, id: 'x', a: 'A', b: 'Z' }
      expect(() => Graph.fromJSON({ nodes: ['A'], edges: [danglingEdge] })).toThrow('unknown node')
    })
  })

  describe('randomized', () => {
    it('matches an edge-list reference under random changes', () => {
      const rng = new Rng(4242)
      const pool = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
      const graph = new Graph()
      // Reference: a set of nodes and a list of edges. Neighbours are found by scanning the list.
      const refNodes = new Set<string>()
      let refEdges: { id: string; a: string; b: string; up: boolean }[] = []
      const pick = () => pool[rng.int(0, pool.length - 1)]

      for (let step = 0; step < 3_000; step++) {
        const action = rng.int(0, 4)
        if (action === 0) {
          const node = pick()
          expect(graph.addNode(node)).toBe(!refNodes.has(node))
          refNodes.add(node)
        } else if (action === 1) {
          const node = pick()
          expect(graph.removeNode(node)).toBe(refNodes.has(node))
          refNodes.delete(node)
          refEdges = refEdges.filter((edge) => edge.a !== node && edge.b !== node)
        } else if (action === 2) {
          const a = pick()
          const b = pick()
          const joined = refEdges.some(
            (edge) => (edge.a === a && edge.b === b) || (edge.a === b && edge.b === a),
          )
          if (refNodes.has(a) && refNodes.has(b) && a !== b && !joined) {
            const edge = graph.addEdge(a, b)
            refEdges.push({ id: edge.id, a, b, up: true })
          } else {
            expect(() => graph.addEdge(a, b)).toThrow()
          }
        } else if (refEdges.length > 0) {
          const target = refEdges[rng.int(0, refEdges.length - 1)]
          if (action === 3) {
            expect(graph.removeEdge(target.id)).toBe(true)
            refEdges = refEdges.filter((edge) => edge.id !== target.id)
          } else {
            target.up = !target.up
            graph.setEdgeUp(target.id, target.up)
          }
        }

        expect(graph.nodes().sort()).toEqual([...refNodes].sort())
        expect(graph.edges().map(({ id, a, b, up }) => ({ id, a, b, up }))).toEqual(refEdges)
        for (const node of refNodes) {
          for (const onlyUp of [false, true]) {
            const expected = refEdges
              .filter((edge) => (edge.a === node || edge.b === node) && (edge.up || !onlyUp))
              .map((edge) => (edge.a === node ? edge.b : edge.a))
              .sort()
            expect(neighborIds(graph, node, onlyUp)).toEqual(expected)
          }
        }
      }
    })
  })
})
