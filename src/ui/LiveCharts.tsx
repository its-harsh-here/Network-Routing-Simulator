import { memo } from 'react'
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import type { ChartData, ChartPoint } from './panel.ts'

interface Series {
  key: keyof Omit<ChartPoint, 't'>
  name: string
  colour: string
}

const AXIS = { fill: '#64748b', fontSize: 10 }

/**
 * Latency, throughput and queued packets over the last 75 simulated seconds, with link
 * failures as red lines (green dashed when a link comes back). The data changes at most twice a
 * second, and nothing is animated, so the charts stay cheap next to the canvas.
 * Render: O(samples + markers): at most maxSamples points per line.
 */
function LiveCharts({ chart }: { chart: ChartData }) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Chart
        title="Latency (ms)"
        chart={chart}
        series={[
          { key: 'avg', name: 'average', colour: '#38bdf8' },
          { key: 'p95', name: 'p95', colour: '#f472b6' },
        ]}
      />
      <Chart
        title="Throughput (pkt/s)"
        chart={chart}
        series={[{ key: 'throughput', name: 'delivered', colour: '#facc15' }]}
      />
      <Chart
        title="Queued packets (all routers)"
        chart={chart}
        series={[{ key: 'queued', name: 'queued', colour: '#a78bfa' }]}
      />
    </div>
  )
}

export default memo(LiveCharts)

function Chart(props: { title: string; chart: ChartData; series: Series[] }) {
  const { chart } = props
  return (
    <figure className="min-w-0 rounded-lg border border-slate-800 bg-slate-900 px-2 pt-1.5 pb-1">
      <figcaption className="flex justify-between gap-2 px-1 text-[11px] text-slate-400">
        <span>{props.title}</span>
        <span className="flex gap-2">
          {props.series.map((s) => (
            <span key={s.key} className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-3" style={{ backgroundColor: s.colour }} />
              {s.name}
            </span>
          ))}
        </span>
      </figcaption>
      <div className="h-28">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chart.points} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              domain={[chart.from, chart.to]}
              allowDataOverflow
              tickCount={6}
              tickFormatter={(t: number) => `${Math.round(t)}s`}
              tick={AXIS}
              stroke="#334155"
            />
            <YAxis width={34} tick={AXIS} stroke="#334155" allowDecimals={false} />
            <Tooltip
              isAnimationActive={false}
              contentStyle={{
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 6,
                fontSize: 11,
              }}
              labelFormatter={(t) => `${Number(t).toFixed(1)} s`}
              formatter={(value) => (typeof value === 'number' ? Math.round(value) : value)}
            />
            {chart.markers.map((marker) => (
              <ReferenceLine
                key={marker.id}
                x={marker.t}
                stroke={marker.up ? '#4ade80' : '#ef4444'}
                strokeDasharray={marker.up ? '4 3' : undefined}
                ifOverflow="hidden"
              />
            ))}
            {props.series.map((s) => (
              <Line
                key={s.key}
                dataKey={s.key}
                name={s.name}
                type="linear"
                stroke={s.colour}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  )
}
