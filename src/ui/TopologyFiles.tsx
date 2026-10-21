import { useRef, useState } from 'react'
import type { Topology } from '../topology/presets.ts'
import { downloadTopology, readTopologyFromFile } from './topologyFile.ts'

const BUTTON =
  'flex-1 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'

/**
 * Save the network as a JSON file, or load one; a file that cannot be read says why.
 * Render: O(errors). Save is O(V + E); Load is O(file size + V + E).
 */
export default function TopologyFiles(props: {
  /** The network to save, read when Save is clicked. */
  current: () => Topology
  onLoad: (topology: Topology) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [problem, setProblem] = useState<{ file: string; errors: string[] } | null>(null)

  const load = async (file: File) => {
    const result = await readTopologyFromFile(file)
    if (result.ok) {
      setProblem(null)
      props.onLoad(result.topology)
    } else {
      setProblem({ file: file.name, errors: result.errors })
    }
  }

  return (
    <>
      <div className="flex gap-2">
        <button type="button" onClick={() => downloadTopology(props.current())} className={BUTTON}>
          Save as JSON
        </button>
        <button type="button" onClick={() => inputRef.current?.click()} className={BUTTON}>
          Load JSON…
        </button>
        <input
          ref={inputRef}
          type="file"
          accept=".json,application/json"
          aria-label="Topology file to load"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = '' // so picking the same file again loads it again
            if (file !== undefined) void load(file)
          }}
        />
      </div>
      {problem !== null && (
        <div
          role="alert"
          className="mt-2 rounded-md bg-red-950/60 p-2 text-xs text-red-200 ring-1 ring-red-800"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">Could not load {problem.file}:</p>
            <button
              type="button"
              onClick={() => setProblem(null)}
              aria-label="Dismiss"
              className="text-red-300 hover:text-white"
            >
              ×
            </button>
          </div>
          <ul className="mt-1 list-disc space-y-0.5 pl-4">
            {problem.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}
