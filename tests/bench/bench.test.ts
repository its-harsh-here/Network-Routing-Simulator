import { describe, expect, it } from 'vitest'
import { bfs } from '../../src/algo/bfs.ts'
import { findBridgesAndArticulationPoints } from '../../src/algo/tarjan.ts'
import { Rng } from '../../src/sim/rng.ts'
import { mesh, ring } from '../../src/topology/presets.ts'
import { pickNonBridgeLinks } from '../../bench/convergence.ts'
import { benchDijkstra } from '../../bench/dijkstra.ts'
import { fromCsv, median, randomConnectedGraph, toCsv } from '../../bench/lib.ts'
import { groupedBarPanels, logLogLineChart, niceCeil, shortNumber } from '../../bench/svg.ts'

describe('benchmark helpers', () => {
  it('takes the median of odd and even counts, like sorting does', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([7])).toBe(7)
    expect(() => median([])).toThrow(RangeError)
    const rng = new Rng(5)
    for (let trial = 0; trial < 100; trial++) {
      const values = Array.from({ length: rng.randomInt(1, 9) }, () => rng.uniform(-10, 10))
      const sorted = [...values].sort((a, b) => a - b)
      const n = sorted.length
      const expected = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2
      expect(median(values)).toBe(expected)
    }
  })

  it('builds connected graphs with average degree 4, the same for the same seed', () => {
    for (const nodes of [1, 2, 5, 50, 300]) {
      const degree = nodes < 5 ? (nodes - 1) * 1 : 4
      const graph = randomConnectedGraph(new Rng(nodes), nodes, degree)
      expect(graph.nodeCount).toBe(nodes)
      expect(graph.edgeCount).toBe(Math.round((degree * nodes) / 2))
      const reached = [...bfs(graph, 'n0').hops.values()].filter((h) => h < Infinity)
      expect(reached.length).toBe(nodes) // connected
    }
    const a = randomConnectedGraph(new Rng(9), 100, 4).toJSON()
    const b = randomConnectedGraph(new Rng(9), 100, 4).toJSON()
    expect(a).toEqual(b)
    expect(() => randomConnectedGraph(new Rng(1), 4, 10)).toThrow(RangeError)
  })

  it('writes CSV that reads back the same, quoting where needed', () => {
    const rows = [
      { name: 'ring(20)', setup: 'DV, no split horizon', value: 12.5 },
      { name: 'say "hi"', setup: 'a', value: 0 },
    ]
    const text = toCsv(rows)
    expect(text.split('\n')[0]).toBe('name,setup,value')
    expect(fromCsv(text)).toEqual(rows.map((r) => ({ ...r, value: String(r.value) })))
    expect(toCsv([])).toBe('')
  })

  it('times both Dijkstras on small graphs and checks they agree', () => {
    const rows = benchDijkstra([50, 80], 3, 2)
    expect(rows.map((r) => [r.nodes, r.links, r.runs])).toEqual([
      [50, 100, 3],
      [80, 160, 3],
    ])
    for (const row of rows) {
      expect(row.heap_min_ms).toBeLessThanOrEqual(row.heap_median_ms)
      expect(row.heap_median_ms).toBeLessThanOrEqual(row.heap_max_ms)
      expect(row.speedup).toBeGreaterThan(0)
    }
  })

  it('picks distinct links that are not bridges, the same for the same seed', () => {
    // A ring of 12 with a tail of two routers: the tail's two links are bridges.
    const topology = ring(12)
    for (const [id, to] of [
      ['T1', 'R0'],
      ['T2', 'T1'],
    ]) {
      topology.graph.addNode(id)
      topology.graph.addEdge(id, to, { id: `${id}-${to}` })
    }
    const bridges = new Set(
      findBridgesAndArticulationPoints(topology.graph).bridges.map((e) => e.id),
    )
    expect([...bridges].sort()).toEqual(['T1-R0', 'T2-T1'])
    const picked = pickNonBridgeLinks(topology, 10, new Rng(7))
    expect(picked.length).toBe(10)
    expect(new Set(picked).size).toBe(10)
    expect(picked.some((id) => bridges.has(id))).toBe(false)
    expect(pickNonBridgeLinks(topology, 10, new Rng(7))).toEqual(picked)
    // Asking for more than there are gives all 12 ring links, and never a bridge.
    expect(pickNonBridgeLinks(topology, 50, new Rng(1)).sort()).toEqual(
      ring(12)
        .graph.edges()
        .map((e) => e.id)
        .sort(),
    )
    // The benchmark's mesh happens to have no bridges at all, so nothing is left out there.
    expect(findBridgesAndArticulationPoints(mesh(40, 0.1, 7).graph).bridges).toEqual([])
  })

  it('draws charts with one line per series and one bar per value', () => {
    const line = logLogLineChart({
      title: 'T',
      xLabel: 'x',
      yLabel: 'y',
      yUnit: ' ms',
      series: [
        {
          name: 'a',
          colour: '#000',
          points: [
            { x: 100, y: 0.5 },
            { x: 1000, y: 5 },
          ],
        },
        {
          name: 'b <c>',
          colour: '#f00',
          points: [
            { x: 100, y: 1 },
            { x: 1000, y: 100 },
          ],
        },
      ],
    })
    expect(line.match(/<polyline/g)?.length).toBe(2)
    expect(line).toContain('b &lt;c&gt;') // text is escaped
    const bars = groupedBarPanels({
      title: 'B',
      groups: ['g1', 'g2'],
      series: [
        { name: 's1', colour: '#000' },
        { name: 's2', colour: '#111' },
      ],
      panels: [
        {
          title: 'p',
          values: [
            [1, 2],
            [3, 4],
          ],
        },
      ],
    })
    expect(bars.match(/<rect x="[\d.]+" y="[\d.]+" width/g)?.length).toBe(4 + 2) // bars + legend
    expect(niceCeil(0.37)).toBe(0.5)
    expect(niceCeil(120)).toBe(200)
    expect(niceCeil(1000)).toBe(1000)
    expect(shortNumber(20_000)).toBe('20k')
    expect(shortNumber(0.01)).toBe('0.01')
  })
})
