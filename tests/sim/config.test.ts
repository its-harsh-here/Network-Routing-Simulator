import { describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, resolveConfig, type SimConfig } from '../../src/sim/config.ts'

describe('resolveConfig', () => {
  it('uses the defaults for anything left out', () => {
    expect(resolveConfig()).toEqual(DEFAULT_CONFIG)
    expect(resolveConfig({ seed: 99 })).toEqual({ ...DEFAULT_CONFIG, seed: 99 })
  })

  it('allows traffic and sampling to be turned off', () => {
    const config = resolveConfig({ packetsPerSecond: 0, statsIntervalMs: 0 })
    expect(config.packetsPerSecond).toBe(0)
    expect(config.statsIntervalMs).toBe(0)
  })

  it('rejects invalid values', () => {
    const bad: Partial<SimConfig>[] = [
      { queueCapacity: 0 },
      { queueCapacity: 1.5 },
      { defaultTtl: -1 },
      { packetsPerSecond: -1 },
      { packetsPerSecond: Infinity },
      { statsIntervalMs: NaN },
      { maxSamples: 0 },
      { detectionDelayMs: -1 },
      { queueDiscipline: 'lifo' as never },
      { linkQueueDiscipline: { ab: 'random' as never } },
      { latencyWindowMs: 0 },
      { priorityMix: { video: 0, web: 0, bulk: 0 } },
      { priorityMix: { video: -1, web: 2, bulk: 0 } },
      { packetSizeBytes: { video: 0, web: 600, bulk: 1500 } },
    ]
    for (const overrides of bad) expect(() => resolveConfig(overrides)).toThrow(RangeError)
  })
})
