import { describe, expect, it } from 'vitest'
import { isConnected } from '../../src/algo/bfs.ts'
import { findBridgesAndArticulationPoints } from '../../src/algo/tarjan.ts'
import { Rng } from '../../src/sim/rng.ts'
import {
  grid,
  line,
  mapLinks,
  mesh,
  PRESET_LINK,
  ring,
  star,
  type Topology,
} from '../../src/topology/presets.ts'

/** Problems with a topology's positions: every router needs one, inside the unit square. */
function positionProblems(topology: Topology): string[] {
  const problems: string[] = []
  for (const node of topology.graph.nodes()) {
    const point = topology.positions[node]
    if (point === undefined) problems.push(`${node} has no position`)
    else if (!(point.x >= 0 && point.x <= 1 && point.y >= 0 && point.y <= 1)) {
      problems.push(`${node} is outside [0, 1]: ${point.x}, ${point.y}`)
    }
  }
  if (Object.keys(topology.positions).length !== topology.graph.nodeCount) {
    problems.push('positions for routers that do not exist')
  }
  return problems
}

const degree = (topology: Topology, node: string) => topology.graph.neighbors(node).length

describe('line', () => {
  it('chains n routers left to right with default links', () => {
    const topology = line(4)
    expect(topology.graph.nodes()).toEqual(['R0', 'R1', 'R2', 'R3'])
    expect(topology.graph.edges().map((e) => e.id)).toEqual(['R0-R1', 'R1-R2', 'R2-R3'])
    expect(topology.graph.getEdge('R0-R1')).toMatchObject({ ...PRESET_LINK, up: true })
    expect(topology.positions.R0.x).toBeCloseTo(0.1, 12)
    expect(topology.positions.R3.x).toBeCloseTo(0.9, 12)
    expect(topology.graph.nodes().every((node) => topology.positions[node].y === 0.5)).toBe(true)
    expect(positionProblems(topology)).toEqual([])
    // Every link and every inner router is a single point of failure.
    const { bridges, articulationPoints } = findBridgesAndArticulationPoints(topology.graph)
    expect(bridges.length).toBe(3)
    expect(articulationPoints.sort()).toEqual(['R1', 'R2'])
  })

  it('works with a single router', () => {
    const topology = line(1)
    expect(topology.graph.nodeCount).toBe(1)
    expect(topology.graph.edgeCount).toBe(0)
    expect(positionProblems(topology)).toEqual([])
  })
})

describe('ring', () => {
  it('closes the line into a circle with no single point of failure', () => {
    const topology = ring(6)
    expect(topology.graph.edgeCount).toBe(6)
    expect(topology.graph.getEdge('R5-R0')).toBeDefined()
    expect(topology.graph.nodes().every((node) => degree(topology, node) === 2)).toBe(true)
    expect(findBridgesAndArticulationPoints(topology.graph)).toEqual({
      bridges: [],
      articulationPoints: [],
    })
    expect(topology.positions.R0.y).toBeCloseTo(0.1, 12) // starts at the top
    expect(positionProblems(topology)).toEqual([])
  })
})

describe('star', () => {
  it('links every leaf to the hub R0', () => {
    const topology = star(5)
    expect(topology.graph.edgeCount).toBe(4)
    expect(degree(topology, 'R0')).toBe(4)
    expect(topology.positions.R0).toEqual({ x: 0.5, y: 0.5 })
    expect(findBridgesAndArticulationPoints(topology.graph).articulationPoints).toEqual(['R0'])
    expect(positionProblems(topology)).toEqual([])
  })
})

describe('grid', () => {
  it('builds a rows x cols lattice numbered row by row', () => {
    const topology = grid(3, 4)
    expect(topology.graph.nodeCount).toBe(12)
    expect(topology.graph.edgeCount).toBe(3 * 3 + 4 * 2) // horizontal + vertical
    // R5 is row 1, column 1: neighbours above, left, right and below.
    const neighbours = topology.graph
      .neighbors('R5')
      .map((n) => n.node)
      .sort()
    expect(neighbours).toEqual(['R1', 'R4', 'R6', 'R9'])
    expect(degree(topology, 'R0')).toBe(2) // corner
    expect(topology.positions.R0).toEqual({ x: 0.1, y: 0.1 })
    expect(topology.positions.R11.x).toBeCloseTo(0.9, 12)
    expect(topology.positions.R11.y).toBeCloseTo(0.9, 12)
    expect(topology.name).toBe('grid 3x4')
    expect(positionProblems(topology)).toEqual([])
  })

  it('handles a single row or a single router', () => {
    expect(grid(1, 5).graph.edgeCount).toBe(4)
    expect(grid(1, 1).graph.edgeCount).toBe(0)
    expect(positionProblems(grid(1, 1))).toEqual([])
  })
})

describe('mesh', () => {
  it('is always connected and drawable, for many sizes, densities and seeds', () => {
    const rng = new Rng(77)
    const problems: string[] = []
    for (let seed = 1; seed <= 60; seed++) {
      const n = rng.randomInt(1, 40)
      const p = rng.uniform(0, 0.3)
      const topology = mesh(n, p, seed)
      if (!isConnected(topology.graph)) problems.push(`seed ${seed}: not connected`)
      problems.push(...positionProblems(topology))
      for (const edge of topology.graph.edges()) {
        if (!(edge.delayMs >= 1 && Number.isInteger(edge.cost) && edge.cost >= 1)) {
          problems.push(`seed ${seed}: odd link ${JSON.stringify(edge)}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('is a tree when p = 0 and complete when p = 1', () => {
    expect(mesh(12, 0, 3).graph.edgeCount).toBe(11)
    expect(mesh(12, 1, 3).graph.edgeCount).toBe((12 * 11) / 2)
  })

  it('gives the same network for the same seed and a different one for another seed', () => {
    const json = (seed: number) => JSON.stringify({ ...mesh(15, 0.2, seed), name: '' })
    expect(json(5)).toBe(json(5))
    expect(json(5)).not.toBe(json(6))
  })

  it('makes longer links slower', () => {
    const topology = mesh(20, 0.3, 9)
    const length = (a: string, b: string) => {
      const [p, q] = [topology.positions[a], topology.positions[b]]
      return Math.hypot(p.x - q.x, p.y - q.y)
    }
    const edges = topology.graph.edges().sort((x, y) => length(x.a, x.b) - length(y.a, y.b))
    expect(edges[0].delayMs).toBeLessThan(edges[edges.length - 1].delayMs)
  })
})

describe('preset options and errors', () => {
  it('lets the caller override link settings', () => {
    const custom = { cost: 3, bandwidthBps: 1_000_000, delayMs: 7 }
    for (const topology of [
      line(3, custom),
      ring(3, custom),
      star(3, custom),
      grid(2, 2, custom),
      mesh(5, 0.5, 1, custom),
    ]) {
      expect(topology.graph.edges().every((e) => e.cost === 3 && e.delayMs === 7)).toBe(true)
    }
  })

  it('rejects sizes that make no sense', () => {
    expect(() => line(0)).toThrow(RangeError)
    expect(() => ring(2)).toThrow(RangeError)
    expect(() => star(1)).toThrow(RangeError)
    expect(() => grid(0, 3)).toThrow(RangeError)
    expect(() => grid(2, 1.5)).toThrow(RangeError)
    expect(() => mesh(0, 0.1)).toThrow(RangeError)
    expect(() => mesh(5, 1.5)).toThrow(RangeError)
  })
})

describe('mapLinks', () => {
  it('changes link settings and keeps everything else', () => {
    const original = grid(2, 2)
    original.graph.setEdgeUp('R0-R1', false)
    const slow = mapLinks(original, (edge) => ({ delayMs: edge.delayMs * 10, bandwidthBps: 1_000 }))
    expect(slow.name).toBe(original.name)
    expect(slow.positions).toEqual(original.positions)
    expect(slow.graph.nodes()).toEqual(original.graph.nodes())
    expect(slow.graph.edges()).toEqual(
      original.graph.edges().map((edge) => ({ ...edge, delayMs: 20, bandwidthBps: 1_000 })),
    )
    expect(slow.graph.getEdge('R0-R1')?.up).toBe(false)
    // The original is untouched.
    expect(original.graph.getEdge('R0-R1')?.delayMs).toBe(2)
  })
})

describe('mesh spacing', () => {
  it('keeps routers at least 0.5 / sqrt(n) apart', () => {
    const problems: string[] = []
    for (const [n, seed] of [
      [10, 1],
      [30, 42],
      [30, 7],
      [60, 3],
    ]) {
      const points = Object.values(mesh(n, 0.05, seed).positions)
      let closest = Infinity
      for (let i = 0; i < points.length; i++) {
        for (let j = i + 1; j < points.length; j++) {
          closest = Math.min(
            closest,
            Math.hypot(points[i].x - points[j].x, points[i].y - points[j].y),
          )
        }
      }
      if (closest < 0.5 / Math.sqrt(n)) problems.push(`n=${n} seed=${seed}: closest ${closest}`)
    }
    expect(problems).toEqual([])
  })
})
