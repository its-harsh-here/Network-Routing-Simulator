import { describe, expect, it } from 'vitest'
import { grid } from '../../src/topology/presets.ts'
import { serializeTopology } from '../../src/topology/json.ts'
import {
  MAX_FILE_BYTES,
  readTopologyFromFile,
  topologyFileName,
} from '../../src/ui/topologyFile.ts'

describe('topology files in the browser', () => {
  it('names files after the network', () => {
    expect(topologyFileName('grid 5x5')).toBe('grid-5x5.json')
    expect(topologyFileName('  My Lab: Floor #2 ')).toBe('my-lab-floor-2.json')
    expect(topologyFileName('***')).toBe('network.json')
  })

  it('reads a picked file, naming an unnamed network after the file', async () => {
    const text = serializeTopology({ ...grid(2, 2), name: '' })
    const result = await readTopologyFromFile(new File([text], 'lab.json'))
    expect(result.ok && result.topology.name).toBe('lab')
    expect(result.ok && result.topology.graph.nodeCount).toBe(4)
  })

  it('refuses a file that is too large before reading it', async () => {
    const big = new File([new Uint8Array(MAX_FILE_BYTES + 1)], 'big.json')
    expect(await readTopologyFromFile(big)).toEqual({
      ok: false,
      errors: ['The file is 2.0 MB; the limit is 2 MB.'],
    })
  })
})
