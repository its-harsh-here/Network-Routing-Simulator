import { describe, expect, it } from 'vitest'
import { bellmanFord, bellmanFordArcs, type Arc } from '../../src/algo/bellmanFord.ts'
import type { NodeId } from '../../src/ds/Graph.ts'
import { Rng } from '../../src/sim/rng.ts'
import { floydWarshall, sampleGraph } from './helpers.ts'

describe('bellmanFord', () => {
  it('finds the cheapest paths in the sample graph', () => {
    const { dist, prev, hasNegativeCycle } = bellmanFord(sampleGraph(), 'A')
    expect(Object.fromEntries(dist)).toEqual({ A: 0, B: 3, C: 1, D: 4, E: 7, F: Infinity })
    expect(Object.fromEntries(prev)).toEqual({ B: 'C', C: 'A', D: 'B', E: 'D' })
    expect(hasNegativeCycle).toBe(false)
  })

  it('ignores links that are down', () => {
    const graph = sampleGraph()
    graph.setEdgeUp('bc', false)
    expect(bellmanFord(graph, 'A').dist.get('E')).toBe(8)
  })

  it('throws for an unknown source', () => {
    expect(() => bellmanFord(sampleGraph(), 'Z')).toThrow('unknown source node')
  })
})

describe('bellmanFordArcs', () => {
  const nodes = ['s', 'a', 'b', 'c']

  it('handles negative arcs without a negative cycle', () => {
    const arcs: Arc[] = [
      { from: 's', to: 'a', cost: 4 },
      { from: 's', to: 'b', cost: 5 },
      { from: 'b', to: 'a', cost: -3 },
    ]
    const { dist, prev, hasNegativeCycle } = bellmanFordArcs(nodes, arcs, 's')
    expect(hasNegativeCycle).toBe(false)
    expect(Object.fromEntries(dist)).toEqual({ s: 0, a: 2, b: 5, c: Infinity })
    expect(prev.get('a')).toBe('b')
  })

  it('detects a negative cycle reachable from the source', () => {
    const arcs: Arc[] = [
      { from: 's', to: 'a', cost: 1 },
      { from: 'a', to: 'b', cost: 1 },
      { from: 'b', to: 'a', cost: -2 },
    ]
    expect(bellmanFordArcs(nodes, arcs, 's').hasNegativeCycle).toBe(true)
  })

  it('ignores a negative cycle the source cannot reach', () => {
    const arcs: Arc[] = [
      { from: 's', to: 'a', cost: 1 },
      { from: 'b', to: 'c', cost: 1 },
      { from: 'c', to: 'b', cost: -2 },
    ]
    const { dist, hasNegativeCycle } = bellmanFordArcs(nodes, arcs, 's')
    expect(hasNegativeCycle).toBe(false)
    expect(dist.get('b')).toBe(Infinity)
  })

  it('detects a negative self-loop on a one-node graph', () => {
    expect(bellmanFordArcs(['s'], [{ from: 's', to: 's', cost: -1 }], 's').hasNegativeCycle).toBe(
      true,
    )
    expect(bellmanFordArcs(['s'], [], 's').hasNegativeCycle).toBe(false)
  })

  it('throws for unknown nodes', () => {
    expect(() => bellmanFordArcs(nodes, [], 'z')).toThrow('unknown source node')
    expect(() => bellmanFordArcs(nodes, [{ from: 's', to: 'z', cost: 1 }], 's')).toThrow(
      'unknown node',
    )
  })

  it('matches Floyd-Warshall on 200 random directed graphs with negative costs', () => {
    const rng = new Rng(555)
    let withCycle = 0
    for (let trial = 0; trial < 200; trial++) {
      const n = rng.randomInt(1, 8)
      const names: NodeId[] = Array.from({ length: n }, (_, i) => `v${i}`)
      const arcs: Arc[] = []
      for (const from of names) {
        for (const to of names) {
          const chance = from === to ? 0.03 : 0.25
          if (rng.uniform() < chance) arcs.push({ from, to, cost: rng.randomInt(-4, 10) })
        }
      }
      const source = names[rng.randomInt(0, n - 1)]
      const allPairs = floydWarshall(names, arcs)
      const fromSource = allPairs.get(source) as Map<NodeId, number>
      // A reachable negative cycle exists if some reachable node has a negative cost to itself.
      const cycle = names.some(
        (v) => (fromSource.get(v) as number) < Infinity && (allPairs.get(v)?.get(v) as number) < 0,
      )
      if (cycle) withCycle++

      const result = bellmanFordArcs(names, arcs, source)
      expect(result.hasNegativeCycle).toBe(cycle)
      if (!cycle) expect(result.dist).toEqual(fromSource)
    }
    expect(withCycle).toBeGreaterThan(10)
    expect(withCycle).toBeLessThan(190)
  })
})
