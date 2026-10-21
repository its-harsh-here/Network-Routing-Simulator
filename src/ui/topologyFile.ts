// Saving a topology as a downloaded file and reading one the user picked.
import { parseTopology, serializeTopology, type ReadResult } from '../topology/json.ts'
import type { Topology } from '../topology/presets.ts'

/** Files larger than this are refused before reading: a real topology file is far smaller. */
export const MAX_FILE_BYTES = 2_000_000

/** A file name for a network: "grid 5x5" becomes "grid-5x5.json". Time: O(name length). */
export function topologyFileName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return `${slug || 'network'}.json`
}

/** Offers the topology to the user as a JSON file download. Time: O(V + E). */
export function downloadTopology(topology: Topology): void {
  const blob = new Blob([serializeTopology(topology)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = topologyFileName(topology.name)
  document.body.append(link)
  link.click()
  link.remove()
  // Give the browser a moment to start the download before the URL is released.
  setTimeout(() => URL.revokeObjectURL(url), 1_000)
}

/**
 * Reads a file the user picked. A file without a network name is named after the file.
 * Time: O(file size + V + E).
 */
export async function readTopologyFromFile(file: File): Promise<ReadResult> {
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / 1e6).toFixed(1)
    return { ok: false, errors: [`The file is ${mb} MB; the limit is ${MAX_FILE_BYTES / 1e6} MB.`] }
  }
  return parseTopology(await file.text(), file.name.replace(/\.json$/i, '') || 'custom')
}
