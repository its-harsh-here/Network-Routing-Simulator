import { useState } from 'react'
import { EVENT_LOG_CAPACITY, LOG_KINDS, type LogEntry, type LogKind } from '../sim/eventLog.ts'

const KIND_LABELS: Record<LogKind, string> = {
  link: 'Links',
  convergence: 'Convergence',
  drops: 'Drops',
  counting: 'Counting to ∞',
}

const KIND_COLOURS: Record<LogKind, string> = {
  link: 'bg-amber-400',
  convergence: 'bg-emerald-400',
  drops: 'bg-red-400',
  counting: 'bg-violet-400',
}

/**
 * The newest notable events, newest first, with a chip per kind to show or hide it.
 * Render: O(n) for the n entries kept (at most EVENT_LOG_CAPACITY).
 */
export default function EventLogPanel({ entries }: { entries: readonly LogEntry[] }) {
  const [hidden, setHidden] = useState<ReadonlySet<LogKind>>(new Set())
  const counts = new Map<LogKind, number>(LOG_KINDS.map((kind) => [kind, 0]))
  for (const entry of entries) counts.set(entry.kind, (counts.get(entry.kind) as number) + 1)
  const shown = entries.filter((entry) => !hidden.has(entry.kind)).reverse()

  const toggle = (kind: LogKind) => {
    const next = new Set(hidden)
    if (next.has(kind)) next.delete(kind)
    else next.add(kind)
    setHidden(next)
  }

  return (
    <>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Show events of these kinds">
        {LOG_KINDS.map((kind) => {
          const on = !hidden.has(kind)
          return (
            <button
              key={kind}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(kind)}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs ring-1 ${
                on
                  ? 'bg-slate-700 text-slate-100 ring-slate-500'
                  : 'bg-slate-900 text-slate-500 ring-slate-700'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${on ? KIND_COLOURS[kind] : 'bg-slate-600'}`}
              />
              {KIND_LABELS[kind]} {counts.get(kind)}
            </button>
          )
        })}
      </div>
      <ol className="mt-2 max-h-72 space-y-0.5 overflow-y-auto pr-1 text-xs">
        {shown.length === 0 && <li className="text-slate-500">Nothing yet. Try cutting a link.</li>}
        {shown.map((entry) => (
          <li key={entry.seq} className="flex gap-2">
            <span className="w-14 shrink-0 text-right font-mono text-slate-500 tabular-nums">
              {(entry.time / 1000).toFixed(2)}s
            </span>
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${KIND_COLOURS[entry.kind]}`} />
            <span className="text-slate-300">{entry.text}</span>
          </li>
        ))}
      </ol>
      <p className="mt-1 text-[11px] text-slate-500">
        The newest {EVENT_LOG_CAPACITY} events, kept in a RingBuffer that overwrites the oldest.
      </p>
    </>
  )
}
