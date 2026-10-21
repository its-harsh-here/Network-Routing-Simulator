import type { ReactNode } from 'react'
import { DROP_REASONS, PRIORITIES } from '../sim/Packet.ts'
import { PRIORITY_COLORS } from './colors.ts'
import type { PanelData } from './panel.ts'
import { LIVE_SIM_CONFIG } from './simulation.ts'
import Sparkline from './Sparkline.tsx'

/**
 * The stats cards. Latency and throughput are over the last 2 simulated seconds.
 * Render: O(n) for the n history points.
 */
export default function StatsCards({ data }: { data: PanelData | null }) {
  const counters = data?.counters
  const history = data?.history ?? []
  const recentDelivery = history.length > 0 ? history[history.length - 1].deliveryPct : null
  const reasons = counters
    ? DROP_REASONS.filter((reason) => counters.dropsByReason[reason] > 0)
        .map((reason) => `${reason} ${counters.dropsByReason[reason]}`)
        .join(' · ')
    : ''

  return (
    <div className="grid grid-cols-2 gap-2">
      <Card label="Generated" value={counters?.generated} />
      <Card label="Delivered" value={counters?.delivered} />
      <Card label="Dropped" value={counters?.dropped} note={reasons || 'none'} />
      <Card
        label="Delivery (last 1 s)"
        value={formatPercent(recentDelivery ?? data?.overallDeliveryPct ?? null)}
        note={`overall ${formatPercent(data?.overallDeliveryPct ?? null)}`}
      >
        <Sparkline values={history.map((p) => p.deliveryPct)} color="#4ade80" floor={90} />
      </Card>
      <Card label="Average latency" value={formatMs(data?.window.avgLatencyMs ?? null)}>
        <Sparkline values={history.map((p) => p.avgLatencyMs)} color="#38bdf8" />
      </Card>
      <Card label="p95 latency" value={formatMs(data?.window.p95LatencyMs ?? null)}>
        <Sparkline values={history.map((p) => p.p95LatencyMs)} color="#f472b6" />
      </Card>
      <Card
        label="Throughput"
        value={data ? `${data.window.throughputPps.toFixed(0)} pkt/s` : undefined}
        wide
      >
        <Sparkline values={history.map((p) => p.throughputPps)} color="#facc15" />
      </Card>
      <ClassTable data={data} />
    </div>
  )
}

/**
 * Latency per traffic class over the window, with delivered and dropped counts for the whole
 * run: with priority queues, video stays fast while bulk waits and is dropped first.
 */
function ClassTable({ data }: { data: PanelData | null }) {
  const cell = 'px-1 py-0.5 text-right font-mono tabular-nums'
  return (
    <div className="col-span-2 rounded-md bg-slate-800/70 px-3 py-2 ring-1 ring-slate-700/60">
      <table className="w-full text-xs">
        <thead className="text-[11px] text-slate-400">
          <tr>
            <th className="py-0.5 text-left font-normal">Class</th>
            <th className="px-1 text-right font-normal">avg</th>
            <th className="px-1 text-right font-normal">p95</th>
            <th className="px-1 text-right font-normal">delivered</th>
            <th className="px-1 text-right font-normal">dropped</th>
          </tr>
        </thead>
        <tbody className="text-slate-100">
          {PRIORITIES.map((priority) => {
            const latency = data?.window.byPriority[priority]
            return (
              <tr key={priority}>
                <td className="py-0.5">
                  <span
                    className="mr-1.5 inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: PRIORITY_COLORS[priority] }}
                  />
                  {priority}
                </td>
                <td className={cell}>{formatMs(latency?.avgLatencyMs ?? null)}</td>
                <td className={cell}>{formatMs(latency?.p95LatencyMs ?? null)}</td>
                <td className={cell}>{data?.counters.deliveredByPriority[priority] ?? '-'}</td>
                <td className={cell}>{data?.counters.droppedByPriority[priority] ?? '-'}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
      <div className="mt-1 text-[11px] text-slate-500">
        Latency over the last {LIVE_SIM_CONFIG.latencyWindowMs / 1000} s; counts since the start.
      </div>
    </div>
  )
}

function Card({
  label,
  value,
  note,
  wide = false,
  children,
}: {
  label: string
  value: ReactNode
  note?: string
  wide?: boolean
  children?: ReactNode
}) {
  return (
    <div
      className={`rounded-md bg-slate-800/70 px-3 py-2 ring-1 ring-slate-700/60 ${wide ? 'col-span-2' : ''}`}
    >
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="font-mono text-lg leading-tight text-slate-50 tabular-nums">
        {value ?? '-'}
      </div>
      {note !== undefined && <div className="truncate text-[11px] text-slate-500">{note}</div>}
      {children}
    </div>
  )
}

function formatPercent(value: number | null): string {
  return value === null ? '-' : `${value.toFixed(1)}%`
}

function formatMs(value: number | null): string {
  if (value === null) return '-'
  return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${value.toFixed(0)} ms`
}
