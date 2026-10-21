import { describe, expect, it } from 'vitest'
import { bfs } from '../../src/algo/bfs.ts'
import { dijkstra } from '../../src/algo/dijkstra.ts'
import { kruskalMST } from '../../src/algo/kruskal.ts'
import { Graph } from '../../src/ds/Graph.ts'
import { simulateBroadcast } from '../../src/routing/broadcast.ts'
import { Rng } from '../../src/sim/rng.ts'
import { line, ring } from '../../src/topology/presets.ts'

describe('simulateBroadcast', () => {
  it('sends one copy per link along a line, each a link delay after the last', () => {
    const result = simulateBroadcast(
      line(4).graph,
      'R0',
      'tree',
      new Set(['R0-R1', 'R1-R2', 'R2-R3']),
    )
    expect(result.messages.map((m) => [m.from, m.to, m.sendAt, m.arriveAt])).toEqual([
      ['R0', 'R1', 0, 2],
      ['R1', 'R2', 2, 4],
      ['R2', 'R3', 4, 6],
    ])
    expect(result).toMatchObject({ duplicates: 0, doneAt: 6 })
  })

  it('floods a ring with two wasted copies where the two waves meet', () => {
    const result = simulateBroadcast(ring(4).graph, 'R0', 'flood')
    // R0 sends 2, R1 and R3 one each, and R2 (reached first by one wave) passes it to the other.
    expect(result.messages.length).toBe(2 * 4 - 4 + 1)
    expect(result.duplicates).toBe(2)
    expect([...result.reached.keys()].sort()).toEqual(['R0', 'R1', 'R2', 'R3'])
    expect(() => simulateBroadcast(ring(4).graph, 'nope', 'flood')).toThrow('unknown router')
  })

  it('matches BFS, Dijkstra and the message-count formulas on random networks', () => {
    const rng = new Rng(2468)
    const problems: string[] = []
    for (let trial = 0; trial < 60; trial++) {
      const n = rng.randomInt(1, 14)
      const graph = new Graph()
      for (let i = 0; i < n; i++) graph.addNode(`r${i}`)
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          if (rng.uniform() < 0.3) {
            graph.addEdge(`r${a}`, `r${b}`, {
              cost: rng.randomInt(1, 5),
              delayMs: rng.randomInt(1, 9),
              up: rng.uniform() > 0.15, // some links are down
            })
          }
        }
      }
      const source = `r${rng.randomInt(0, n - 1)}`

      // Reference: the routers that can hear the source, and the links up among them.
      const component = [...bfs(graph, source).hops].filter(([, h]) => h < Infinity).map(([r]) => r)
      const inside = new Set(component)
      const upLinks = graph.edges().filter((e) => e.up && inside.has(e.a))
      // First arrival under flooding = shortest delay path: Dijkstra with delay as the cost.
      const byDelay = new Graph()
      for (const node of graph.nodes()) byDelay.addNode(node)
      for (const e of graph.edges()) byDelay.addEdge(e.a, e.b, { cost: e.delayMs, up: e.up })
      const { dist } = dijkstra(byDelay, source)

      const flood = simulateBroadcast(graph, source, 'flood')
      if ([...flood.reached.keys()].sort().join() !== [...component].sort().join()) {
        problems.push(`trial ${trial}: flood reached the wrong routers`)
      }
      for (const [router, time] of flood.reached) {
        if (time !== dist.get(router)) problems.push(`trial ${trial}: flood reached ${router} late`)
      }
      const floodCount = 2 * upLinks.length - component.length + 1
      if (flood.messages.length !== floodCount) problems.push(`trial ${trial}: flood count`)
      if (flood.duplicates !== floodCount - (component.length - 1)) {
        problems.push(`trial ${trial}: flood duplicates`)
      }

      const tree = new Set(kruskalMST(graph).map((e) => e.id))
      const viaTree = simulateBroadcast(graph, source, 'tree', tree)
      if (viaTree.reached.size !== component.length) problems.push(`trial ${trial}: tree reach`)
      if (viaTree.messages.length !== component.length - 1 || viaTree.duplicates !== 0) {
        problems.push(`trial ${trial}: tree count`)
      }
      // Reference arrival times: walk the tree from the source, adding link delays.
      const treeTime = new Map([[source, 0]])
      const stack = [source]
      while (stack.length > 0) {
        const router = stack.pop() as string
        for (const { node, edge } of graph.neighbors(router, { onlyUp: true })) {
          if (!tree.has(edge.id) || treeTime.has(node)) continue
          treeTime.set(node, (treeTime.get(router) as number) + edge.delayMs)
          stack.push(node)
        }
      }
      for (const [router, time] of viaTree.reached) {
        if (treeTime.get(router) !== time) problems.push(`trial ${trial}: tree time at ${router}`)
      }
      // A tree never beats flooding to any router: flooding finds the fastest path.
      for (const [router, time] of viaTree.reached) {
        if (time < (flood.reached.get(router) as number))
          problems.push(`trial ${trial}: tree faster`)
      }
    }
    expect(problems).toEqual([])
  })
})
