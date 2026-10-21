import { describe, expect, it } from 'vitest'
import { EVENT_LOG_CAPACITY, EventLog, type LogKind } from '../../src/sim/eventLog.ts'
import { Rng } from '../../src/sim/rng.ts'
import { Simulator } from '../../src/sim/Simulator.ts'
import { countToInfinity, line, ring } from '../../src/topology/presets.ts'

const QUIET = { packetsPerSecond: 0, statsIntervalMs: 0 }

describe('EventLog', () => {
  it('keeps the newest entries, oldest first, numbering every entry ever added', () => {
    const log = new EventLog(3)
    expect(log.toArray()).toEqual([])
    for (let i = 0; i < 5; i++) log.add(i * 10, 'link', `event ${i}`)
    expect(log.toArray().map((e) => [e.seq, e.time, e.text])).toEqual([
      [2, 20, 'event 2'],
      [3, 30, 'event 3'],
      [4, 40, 'event 4'],
    ])
    expect(log.size).toBe(3)
    expect(log.total).toBe(5)
    expect(() => new EventLog(0)).toThrow(RangeError)
  })

  it('matches "the last n of everything" under random use', () => {
    const rng = new Rng(17)
    for (let trial = 0; trial < 50; trial++) {
      const capacity = rng.randomInt(1, 20)
      const log = new EventLog(capacity)
      const everything: string[] = []
      const adds = rng.randomInt(0, 60)
      for (let i = 0; i < adds; i++) {
        const text = `e${i}`
        log.add(i, rng.pick(['link', 'drops'] as LogKind[]), text)
        everything.push(text)
      }
      expect(log.toArray().map((e) => e.text)).toEqual(everything.slice(-capacity))
    }
  })
})

describe('what the simulator logs', () => {
  const texts = (sim: Simulator, kind: LogKind) =>
    sim.log
      .toArray()
      .filter((e) => e.kind === kind)
      .map((e) => e.text)

  it('a cut, its detection and the convergence that follows', () => {
    const sim = new Simulator(ring(6).graph, { ...QUIET, detectionDelayMs: 50 })
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    sim.schedule(2_000, { type: 'LINK_UP', linkId: 'R1-R2' })
    sim.runUntil(3_000)
    expect(texts(sim, 'link')).toEqual([
      'Link R1-R2 cut',
      'R1 and R2 noticed that R1-R2 is down',
      'Link R1-R2 restored',
      'R1 and R2 noticed that R1-R2 is up',
    ])
    // Down: each end's LSA crosses the 5 links left (10). Up: each LSA floods the whole ring,
    // 2 + 5 * 1 = 7 messages, and the two ends swap databases: 7 + 7 + 2 = 16.
    expect(texts(sim, 'convergence')).toEqual([
      'Converged 54 ms after R1-R2 went down: 0 packets lost, 10 routing messages',
      'Converged 56 ms after R1-R2 went up: 0 packets lost, 16 routing messages',
    ])
    const times = sim.log.toArray().map((e) => e.time)
    expect(times).toEqual([...times].sort((a, b) => a - b)) // in time order
    expect(texts(sim, 'counting')).toEqual([]) // link-state never counts to infinity
  })

  it('sums drops up at most once a second, by reason', () => {
    const sim = new Simulator(line(3).graph, { ...QUIET, statsIntervalMs: 250 })
    sim.schedule(1_000, { type: 'LINK_DOWN', linkId: 'R1-R2' })
    for (let time = 0; time <= 5_000; time += 10) {
      sim.runUntil(time)
      sim.sendPacket('R0', 'R2')
    }
    sim.runUntil(6_500)
    const drops = sim.log.toArray().filter((e) => e.kind === 'drops')
    expect(drops.length).toBeGreaterThanOrEqual(4)
    for (let i = 1; i < drops.length; i++) {
      expect(drops[i].time - drops[i - 1].time).toBeGreaterThanOrEqual(1_000)
    }
    expect(drops[0].text).toMatch(/^\d+ packets dropped in 1\.\d s: no-route \d+$/)
    // Every drop is in exactly one summary: the numbers add up to the total.
    const summed = drops.reduce((sum, e) => sum + Number(e.text.split(' ')[0]), 0)
    expect(summed).toBe(sim.stats.counters.dropped)
  })

  it('each step of counting to infinity, without split horizon', () => {
    const counting = (splitHorizon: boolean) => {
      const sim = new Simulator(countToInfinity().graph, {
        ...QUIET,
        routing: 'distance-vector',
        splitHorizon,
        detectionDelayMs: 10,
      })
      sim.runUntil(5_000)
      sim.schedule(5_000, { type: 'LINK_DOWN', linkId: 'B-C' })
      sim.runUntil(60_000)
      return texts(sim, 'counting')
    }
    const steps = counting(false)
    // A and B take turns raising their cost to C by 2 (the A-B link and back) up to 16.
    expect(steps.length).toBeGreaterThan(8)
    expect(steps.some((t) => /^A: cost to C rose \d+ → \d+ via B$/.test(t))).toBe(true)
    expect(steps.some((t) => /^B: cost to C rose \d+ → \d+ via A$/.test(t))).toBe(true)
    expect(steps.filter((t) => t.includes('unreachable')).length).toBe(2) // A and B reach 16
    expect(counting(true)).toEqual([]) // split horizon stops the loop
  })

  it('keeps only the newest 200 entries however long the run', () => {
    const sim = new Simulator(ring(4).graph, { ...QUIET, detectionDelayMs: 5 })
    for (let i = 0; i < 200; i++) {
      sim.schedule(i * 100, { type: i % 2 === 0 ? 'LINK_DOWN' : 'LINK_UP', linkId: 'R0-R1' })
    }
    sim.runUntil(30_000)
    expect(sim.log.total).toBeGreaterThan(EVENT_LOG_CAPACITY)
    expect(sim.log.size).toBe(EVENT_LOG_CAPACITY)
    expect(sim.log.toArray().at(-1)?.seq).toBe(sim.log.total - 1)
  })
})
