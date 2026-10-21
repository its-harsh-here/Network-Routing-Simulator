import { describe, expect, it } from 'vitest'
import { Simulator } from '../../src/sim/Simulator.ts'
import { grid, line } from '../../src/topology/presets.ts'
import { emptyTopology } from '../../src/topology/edit.ts'
import {
  drawScene,
  formatBandwidth,
  linkUtilisation,
  NO_OVERLAYS,
  packetDots,
  queueFill,
  screenPositions,
  tooltipLines,
  type Scene,
} from '../../src/ui/draw.ts'
import { broadcastFrame, planBroadcast } from '../../src/ui/analysis.ts'
import { drawEditor } from '../../src/ui/editorDraw.ts'
import { fitView } from '../../src/ui/view.ts'

/**
 * A stand-in for CanvasRenderingContext2D that records every method call, so tests can check
 * what was drawn without a browser.
 */
function recordingContext() {
  const calls: { name: string; args: unknown[] }[] = []
  const state: Record<string, unknown> = {}
  const ctx = new Proxy(state, {
    get(target, name: string) {
      if (name in target) return target[name]
      return (...args: unknown[]) => {
        calls.push({ name, args })
        return name === 'measureText' ? { width: String(args[0]).length * 7 } : undefined
      }
    },
    set(target, name: string, value) {
      target[name] = value
      return true
    },
  })
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls }
}

describe('drawScene', () => {
  it('draws every link, router and packet, plus the hover tooltip', () => {
    const topology = grid(3, 3)
    const sim = new Simulator(topology.graph, { packetsPerSecond: 0, statsIntervalMs: 0 })
    for (let i = 0; i < 3; i++) sim.sendPacket('R0', 'R8')
    sim.schedule(0, { type: 'LINK_DOWN', linkId: 'R4-R5' })
    sim.runUntil(0.1)
    const snapshot = sim.snapshot()
    expect(snapshot.packets.length).toBe(1) // one sending, two queued

    const { ctx, calls } = recordingContext()
    drawScene(ctx, {
      width: 600,
      height: 400,
      view: fitView(Object.values(topology.positions), 600, 400, 40),
      positions: topology.positions,
      snapshot,
      queueCapacity: sim.config.queueCapacity,
      hover: { kind: 'router', id: 'R0' },
      pointer: { x: 100, y: 100 },
      selectedRouter: 'R4',
      highlightPacketId: snapshot.packets[0].id,
      inspectedRouter: null,
      packetTrail: null,
      path: null,
      overlays: NO_OVERLAYS,
      broadcast: null,
    })
    const count = (name: string) => calls.filter((c) => c.name === name).length
    expect(count('clearRect')).toBe(1)
    expect(count('arc')).toBe(9 + 1 + 1) // routers + packets + the ring around the selected router
    expect(count('lineTo')).toBe(12) // one per link
    expect(count('roundRect')).toBe(1) // the tooltip
    expect(calls.some((c) => c.name === 'fillText' && c.args[0] === 'Router R0')).toBe(true)
    // The down link is drawn dashed.
    expect(calls.some((c) => c.name === 'setLineDash' && (c.args[0] as number[]).length > 0)).toBe(
      true,
    )
  })
})

describe('inspector layers', () => {
  const topology = grid(3, 3)
  const sim = new Simulator(topology.graph, { packetsPerSecond: 0, statsIntervalMs: 0 })
  const packet = sim.sendPacket('R0', 'R8')
  sim.runUntil(3) // on its second link by now
  const snapshot = sim.snapshot()
  const view = fitView(Object.values(topology.positions), 600, 400, 40)
  const base: Scene = {
    width: 600,
    height: 400,
    view,
    positions: topology.positions,
    snapshot,
    queueCapacity: sim.config.queueCapacity,
    hover: null,
    pointer: null,
    selectedRouter: null,
    highlightPacketId: null,
    inspectedRouter: null,
    packetTrail: null,
    path: null,
    overlays: NO_OVERLAYS,
    broadcast: null,
  }
  const draw = (changes: Partial<Scene>) => {
    const { ctx, calls } = recordingContext()
    drawScene(ctx, { ...base, ...changes })
    return (name: string) => calls.filter((c) => c.name === name).length
  }

  it('draws the shortest path, and the forwarding path when it differs', () => {
    const plain = draw({})
    const shortest = ['R0', 'R1', 'R2', 'R5']
    expect(draw({ path: { shortest, forwarding: null } })('lineTo') - plain('lineTo')).toBe(3)
    const both = draw({ path: { shortest, forwarding: ['R0', 'R3', 'R4'] } })
    expect(both('lineTo') - plain('lineTo')).toBe(3 + 2)
  })

  it('draws a packet trail through its hops and on to the packet', () => {
    expect(packet.hops.length).toBe(2)
    const plain = draw({})
    // From R0 to R1, then from R1 to where the packet is on its next link.
    expect(
      draw({ packetTrail: { id: packet.id, hops: packet.hops } })('lineTo') - plain('lineTo'),
    ).toBe(2)
    expect(draw({ inspectedRouter: 'R4' })('arc') - plain('arc')).toBe(1) // the amber ring
  })

  it('puts packet dots where packets are drawn, for clicking them', () => {
    const screen = screenPositions(topology.positions, view)
    const [dot] = packetDots(snapshot, screen)
    const { from, to } = snapshot.packets[0]
    const a = screen.get(from)!
    const b = screen.get(to)!
    expect(dot.id).toBe(packet.id)
    // Between the two routers (allowing for the small sideways offset).
    expect(dot.point.x).toBeGreaterThanOrEqual(Math.min(a.x, b.x) - 5)
    expect(dot.point.x).toBeLessThanOrEqual(Math.max(a.x, b.x) + 5)
    expect(tooltipLines({ kind: 'packet', id: packet.id }, snapshot, 32)).toEqual([
      `Packet #${packet.id} (web)`,
      `R0 → R8, now on ${from} → ${to}`,
      'click to inspect it',
    ])
  })

  it('draws the MST under the links, bridges in red and articulation points ringed', () => {
    const plain = draw({})
    const mst = new Set(['R0-R1', 'R1-R2', 'R2-R5'])
    expect(draw({ overlays: { ...NO_OVERLAYS, mst } })('lineTo') - plain('lineTo')).toBe(3)
    const bridges = new Set(['R0-R1', 'R3-R4'])
    expect(draw({ overlays: { ...NO_OVERLAYS, bridges } })('lineTo') - plain('lineTo')).toBe(2)
    const articulationPoints = new Set(['R4', 'R5'])
    expect(draw({ overlays: { ...NO_OVERLAYS, articulationPoints } })('arc') - plain('arc')).toBe(2)
  })

  it('does not draw a bridge red once it is down', () => {
    const cut = new Simulator(topology.graph, { packetsPerSecond: 0, statsIntervalMs: 0 })
    cut.schedule(0, { type: 'LINK_DOWN', linkId: 'R0-R1' })
    cut.runUntil(0)
    const { ctx, calls } = recordingContext()
    const bridges = new Set(['R0-R1', 'R3-R4'])
    drawScene(ctx, { ...base, snapshot: cut.snapshot(), overlays: { ...NO_OVERLAYS, bridges } })
    const lines = calls.filter((c) => c.name === 'lineTo').length
    expect(lines - draw({})('lineTo')).toBe(1) // only R3-R4
  })

  it('draws broadcast copies in flight as diamonds and rings the routers that have it', () => {
    // Flooding from the corner R0 of the 3x3 grid, 2 ms links: at 3 ms R0's two copies have
    // arrived, and R1 and R3 are each sending two more.
    const demo = planBroadcast(topology.graph, 'R0', 0, 'flood')
    const frame = broadcastFrame(demo, 3)
    expect(frame).not.toBeNull()
    const plain = draw({})
    const counts = draw({ broadcast: frame })
    expect(counts('closePath') - plain('closePath')).toBe(4) // one diamond per copy in flight
    expect(counts('arc') - plain('arc')).toBe(3) // R0, R1 and R3 have it
  })
})

describe('drawEditor', () => {
  it('draws links with their costs, routers, the selection and a link being drawn', () => {
    const topology = line(3)
    const { ctx, calls } = recordingContext()
    drawEditor(ctx, {
      width: 600,
      height: 400,
      view: fitView(Object.values(topology.positions), 600, 400, 40),
      topology,
      selection: { kind: 'link', id: 'R0-R1' },
      hover: null,
      pendingLink: { from: 'R2', pointer: { x: 10, y: 10 }, target: null },
    })
    const count = (name: string) => calls.filter((c) => c.name === name).length
    expect(count('lineTo')).toBe(2 + 1) // two links and the one being drawn
    expect(count('arc')).toBe(3 + 1) // routers, and a ring on the router the new link starts at
    const texts = calls.filter((c) => c.name === 'fillText').map((c) => c.args[0])
    expect(texts).toEqual(['1', '1', 'R0', 'R1', 'R2']) // costs, then router names
  })

  it('says how to start on an empty network', () => {
    const { ctx, calls } = recordingContext()
    drawEditor(ctx, {
      width: 600,
      height: 400,
      view: fitView([], 600, 400, 40),
      topology: emptyTopology(),
      selection: null,
      hover: null,
      pendingLink: null,
    })
    expect(
      calls.some((c) => c.name === 'fillText' && c.args[0] === 'Click anywhere to add a router'),
    ).toBe(true)
  })
})

describe('drawing helpers', () => {
  it('reports a link by its busier direction and a router by its fullest queue', () => {
    const sim = new Simulator(line(3).graph, { packetsPerSecond: 0, statsIntervalMs: 0 })
    for (let i = 0; i < 5; i++) sim.sendPacket('R0', 'R2')
    const snapshot = sim.snapshot()
    const r0 = snapshot.routers.find((r) => r.id === 'R0')
    expect(r0 && queueFill(r0, 32)).toBe(4 / 32) // one sending, four waiting
    const link = { ...snapshot.links[0] }
    link.aToB = { ...link.aToB, utilisation: 0.2 }
    link.bToA = { ...link.bToA, utilisation: 0.7 }
    expect(linkUtilisation(link)).toBe(0.7)
  })

  it('writes tooltips for routers and links', () => {
    const sim = new Simulator(line(3).graph, { packetsPerSecond: 0, statsIntervalMs: 0 })
    for (let i = 0; i < 3; i++) sim.sendPacket('R0', 'R2')
    const snapshot = sim.snapshot()
    expect(tooltipLines({ kind: 'router', id: 'R0' }, snapshot, 32)).toEqual([
      'Router R0',
      'queued: 2 packets',
      'fullest queue: 2/32 (to R1)',
      'links: 1',
      'click to inspect it',
    ])
    expect(tooltipLines({ kind: 'link', id: 'R0-R1' }, snapshot, 32)).toEqual([
      'Link R0-R1 (up)',
      'cost 1 · 10 Mbps · 2 ms',
      'R0 → R1: 0% busy, 2 queued',
      'R1 → R0: 0% busy, 0 queued',
      'click to cut this link',
    ])
    expect(tooltipLines({ kind: 'link', id: 'nope' }, snapshot, 32)).toEqual([])
  })

  it('formats bandwidth with sensible units', () => {
    expect(formatBandwidth(10_000_000)).toBe('10 Mbps')
    expect(formatBandwidth(1_500_000_000)).toBe('1.5 Gbps')
    expect(formatBandwidth(64_000)).toBe('64 kbps')
    expect(formatBandwidth(300)).toBe('300 bps')
  })
})
