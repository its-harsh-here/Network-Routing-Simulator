import type { ReactNode } from 'react'
import type { NodeId } from '../ds/Graph.ts'
import { PROTOCOL_NAMES, type ProtocolName } from '../routing/types.ts'
import type { ConvergenceRecord } from '../sim/convergence.ts'
import { PRIORITIES, type Priority } from '../sim/Packet.ts'
import { QUEUE_DISCIPLINES, type QueueDiscipline } from '../sim/queues.ts'
import { PRESET_NAMES, type PresetName } from '../topology/presets.ts'
import { PRIORITY_COLORS } from './colors.ts'
import {
  formatSpeed,
  LIVE_DV_PERIOD_MS,
  LIVE_SIM_CONFIG,
  plural,
  PROTOCOL_LABELS,
  type RoutingSettings,
  SIZE_LIMITS,
  sliderFromSpeed,
  speedFromSlider,
  type TopologySettings,
} from './simulation.ts'
import type { PickStep } from './useLiveSimulation.ts'

const BUTTON =
  'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700 disabled:opacity-40'
const PRIMARY = 'rounded-md px-3 py-1.5 text-sm font-medium bg-sky-600 text-white hover:bg-sky-500'
/** Shared input style; each use adds its own width. */
const INPUT =
  'rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-slate-700 focus:ring-sky-500 focus:outline-none'

const PRESET_LABELS: Record<PresetName, string> = {
  line: 'Line',
  ring: 'Ring',
  star: 'Star',
  grid: 'Grid',
  mesh: 'Random mesh',
  'count-to-infinity': 'Count to infinity (A-B-C)',
}

const QUEUE_LABELS: Record<QueueDiscipline, string> = {
  fifo: 'FIFO',
  priority: 'Priority',
}

/** A row of buttons of which exactly one is selected, like radio buttons. */
function Segmented<T extends string>(props: {
  label: string
  options: readonly T[]
  labels: Record<T, string>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <div
      className="flex rounded-md ring-1 ring-slate-600"
      role="radiogroup"
      aria-label={props.label}
    >
      {props.options.map((option) => (
        <button
          key={option}
          type="button"
          role="radio"
          aria-checked={props.value === option}
          onClick={() => props.onChange(option)}
          className={`flex-1 px-3 py-1.5 text-sm font-medium first:rounded-l-md last:rounded-r-md ${
            props.value === option
              ? 'bg-sky-600 text-white'
              : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
          }`}
        >
          {props.labels[option]}
        </button>
      ))}
    </div>
  )
}

/** A titled block of the sidebar. Render: O(1), plus its children. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-b border-slate-800 px-4 py-4">
      <h2 className="mb-3 text-xs font-semibold tracking-wide text-slate-400 uppercase">{title}</h2>
      {children}
    </section>
  )
}

/**
 * Play/pause, step, reset, the sim clock, speed and seed.
 * Render: O(1).
 */
export function SimulationControls(props: {
  simTimeMs: number | null
  paused: boolean
  speed: number
  seed: number
  lastEvent: string | null
  onTogglePause: () => void
  onStep: () => void
  onReset: () => void
  onSpeedChange: (speed: number) => void
  onSeedChange: (seed: number) => void
}) {
  return (
    <>
      <div className="flex items-baseline justify-between">
        <span className="text-xs text-slate-400">Simulated time</span>
        <span className="font-mono text-2xl text-slate-50 tabular-nums">
          {props.simTimeMs === null ? '-' : `${(props.simTimeMs / 1000).toFixed(3)} s`}
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <button type="button" onClick={props.onTogglePause} className={`${PRIMARY} w-20`}>
          {props.paused ? 'Play' : 'Pause'}
        </button>
        <button
          type="button"
          onClick={props.onStep}
          className={BUTTON}
          title="Process one event (S)"
        >
          Step
        </button>
        <button type="button" onClick={props.onReset} className={BUTTON} title="Start again (R)">
          Reset
        </button>
      </div>
      {props.lastEvent !== null && (
        <p className="mt-2 font-mono text-xs text-slate-400">Last step: {props.lastEvent}</p>
      )}
      <label className="mt-4 block text-xs text-slate-400">
        <span className="flex justify-between">
          Speed <span className="font-mono text-slate-200">{formatSpeed(props.speed)}</span>
        </span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.001}
          value={sliderFromSpeed(props.speed)}
          onChange={(event) => props.onSpeedChange(speedFromSlider(Number(event.target.value)))}
          className="mt-1 w-full accent-sky-500"
        />
      </label>
      <label className="mt-3 flex items-center gap-2 text-xs text-slate-400">
        Seed
        <input
          type="number"
          value={props.seed}
          onChange={(event) => props.onSeedChange(Math.trunc(Number(event.target.value)) || 0)}
          className={`${INPUT} w-24`}
        />
        <span className="text-slate-500">applies on Reset or Load</span>
      </label>
      <p className="mt-3 text-[11px] text-slate-500">Keys: Space play/pause · S step · R reset</p>
    </>
  )
}

/**
 * Preset, size and Load.
 * Render: O(1) (a fixed number of presets).
 */
export function TopologyControls(props: {
  settings: TopologySettings
  onChange: (settings: TopologySettings) => void
  onLoad: () => void
}) {
  const { settings, onChange } = props
  const limits = SIZE_LIMITS[settings.preset]
  const number = (
    label: string,
    value: number,
    update: (value: number) => TopologySettings,
    min: number,
    max: number,
    step = 1,
  ) => (
    <label className="text-xs text-slate-400">
      {label}
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(event) => onChange(update(Number(event.target.value)))}
        className={`${INPUT} mt-1 w-full`}
      />
    </label>
  )

  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <label className="col-span-2 text-xs text-slate-400">
          Preset
          <select
            value={settings.preset}
            onChange={(event) =>
              onChange({ ...settings, preset: event.target.value as PresetName })
            }
            className={`${INPUT} mt-1 w-full`}
          >
            {PRESET_NAMES.map((name) => (
              <option key={name} value={name}>
                {PRESET_LABELS[name]}
              </option>
            ))}
          </select>
        </label>
        {settings.preset === 'count-to-infinity' ? (
          <p className="col-span-2 text-xs text-slate-400">
            Loads A - B - C with distance-vector routing, split horizon and poison reverse off, 400
            ms links and TTL 8.
          </p>
        ) : settings.preset === 'grid' ? (
          <>
            {number(
              'Rows',
              settings.rows,
              (rows) => ({ ...settings, rows }),
              limits.min,
              limits.max,
            )}
            {number(
              'Columns',
              settings.cols,
              (cols) => ({ ...settings, cols }),
              limits.min,
              limits.max,
            )}
          </>
        ) : (
          number(
            'Routers',
            settings.size,
            (size) => ({ ...settings, size }),
            limits.min,
            limits.max,
          )
        )}
        {settings.preset === 'mesh' &&
          number(
            'Extra-link chance',
            settings.meshP,
            (meshP) => ({ ...settings, meshP }),
            0,
            1,
            0.01,
          )}
      </div>
      <button type="button" onClick={props.onLoad} className={`${PRIMARY} mt-3 w-full`}>
        Load
      </button>
    </>
  )
}

/**
 * Packets per second, priority mix and "send one packet".
 * Render: O(1).
 */
export function TrafficControls(props: {
  packetsPerSecond: number
  priorityMix: Record<Priority, number>
  pickStep: PickStep
  pickedSource: NodeId | null
  sendPriority: Priority
  onRateChange: (packetsPerSecond: number) => void
  onMixChange: (mix: Record<Priority, number>) => void
  onStartPick: () => void
  onCancelPick: () => void
  onSendPriorityChange: (priority: Priority) => void
}) {
  const { priorityMix } = props
  const total = PRIORITIES.reduce((sum, priority) => sum + priorityMix[priority], 0)

  return (
    <>
      <label className="block text-xs text-slate-400">
        <span className="flex justify-between">
          Packets per second
          <span className="font-mono text-slate-200">
            {props.packetsPerSecond === 0 ? 'off' : props.packetsPerSecond}
          </span>
        </span>
        <input
          type="range"
          min={0}
          max={200}
          step={1}
          value={props.packetsPerSecond}
          onChange={(event) => props.onRateChange(Number(event.target.value))}
          className="mt-1 w-full accent-sky-500"
        />
      </label>

      <div className="mt-3 space-y-1">
        <div className="text-xs text-slate-400">Priority mix</div>
        {PRIORITIES.map((priority) => (
          <label key={priority} className="flex items-center gap-2 text-xs text-slate-300">
            <span className="flex w-14 items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 rounded-full"
                style={{ backgroundColor: PRIORITY_COLORS[priority] }}
              />
              {priority}
            </span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={priorityMix[priority]}
              onChange={(event) =>
                props.onMixChange({ ...priorityMix, [priority]: Number(event.target.value) })
              }
              className="flex-1 accent-sky-500"
            />
            <span className="w-10 text-right font-mono text-slate-400">
              {total === 0 ? '-' : `${Math.round((100 * priorityMix[priority]) / total)}%`}
            </span>
          </label>
        ))}
        {total === 0 && (
          <p className="text-xs text-amber-400">
            Give at least one class a weight to send traffic.
          </p>
        )}
      </div>

      <div className="mt-4 flex items-center gap-2">
        {props.pickStep === 'off' ? (
          <button type="button" onClick={props.onStartPick} className={BUTTON}>
            Send one packet
          </button>
        ) : (
          <button type="button" onClick={props.onCancelPick} className={BUTTON}>
            Cancel
          </button>
        )}
        <select
          value={props.sendPriority}
          onChange={(event) => props.onSendPriorityChange(event.target.value as Priority)}
          className={`${INPUT} w-24`}
          aria-label="Priority of the packet to send"
        >
          {PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {priority}
            </option>
          ))}
        </select>
      </div>
      {props.pickStep !== 'off' && (
        <p className="mt-2 text-xs text-sky-300">
          {props.pickStep === 'source'
            ? 'Click the source router on the map.'
            : `From ${props.pickedSource}: now click the destination.`}
        </p>
      )}
    </>
  )
}

/**
 * The protocol switch and the distance-vector options.
 * Render: O(1).
 */
export function RoutingControls(props: {
  routing: RoutingSettings
  control: { sent: number; lost: number } | null
  onProtocolChange: (protocol: ProtocolName) => void
  onOptionChange: (option: 'splitHorizon' | 'poisonReverse', value: boolean) => void
}) {
  const { routing } = props
  const isDistanceVector = routing.protocol === 'distance-vector'
  const option = (key: 'splitHorizon' | 'poisonReverse', label: string) => (
    <label
      className={`flex items-center gap-2 text-sm ${isDistanceVector ? 'text-slate-200' : 'text-slate-500'}`}
    >
      <input
        type="checkbox"
        checked={routing[key]}
        disabled={!isDistanceVector}
        onChange={(event) => props.onOptionChange(key, event.target.checked)}
        className="h-4 w-4 accent-sky-500"
      />
      {label}
    </label>
  )

  return (
    <>
      <Segmented
        label="Routing protocol"
        options={PROTOCOL_NAMES}
        labels={PROTOCOL_LABELS}
        value={routing.protocol}
        onChange={props.onProtocolChange}
      />
      <p className="mt-2 text-xs text-slate-500">
        {isDistanceVector
          ? `Each router tells its neighbours its costs every ${LIVE_DV_PERIOD_MS / 1000} s and whenever they change. Infinity is 16.`
          : 'A router whose link changes floods a link-state advertisement (LSA) to the network; every router keeps a map from the LSAs and runs Dijkstra on it.'}{' '}
        Switching restarts the simulation.
      </p>
      <div className="mt-3 space-y-1.5">
        {option('splitHorizon', 'Split horizon')}
        {option('poisonReverse', 'Poison reverse')}
      </div>
      {props.control !== null && (
        <p className="mt-2 text-xs text-slate-500">
          {isDistanceVector ? 'Routing updates' : 'LSA messages'} sent: {props.control.sent}, lost
          on dead links: {props.control.lost}
        </p>
      )}
    </>
  )
}

/**
 * First-in first-out or priority queues on every link.
 * Render: O(1).
 */
export function QueueControls(props: {
  discipline: QueueDiscipline
  queueCapacity: number
  onChange: (discipline: QueueDiscipline) => void
}) {
  return (
    <>
      <Segmented
        label="Queue discipline"
        options={QUEUE_DISCIPLINES}
        labels={QUEUE_LABELS}
        value={props.discipline}
        onChange={props.onChange}
      />
      <p className="mt-2 text-xs text-slate-500">
        Each link holds up to {props.queueCapacity} packets per direction.{' '}
        {props.discipline === 'fifo'
          ? 'First come, first served; a full queue drops the packet that arrives.'
          : 'Video goes before web, web before bulk; a full queue drops its newest lowest-class packet to make room.'}{' '}
        Switching restarts the simulation.
      </p>
    </>
  )
}

/**
 * How to cut links, and the latest link changes.
 * Render: O(1): at most RECENT_CHANGES changes.
 */
export function FailureControls(props: {
  linksDown: number
  recentChanges: ConvergenceRecord[]
  protocol: ProtocolName
}) {
  return (
    <>
      <p className="text-xs text-slate-400">
        Click a link on the map to cut it, and again to restore it. Routers notice after{' '}
        {LIVE_SIM_CONFIG.detectionDelayMs / 1000} s
        {props.protocol === 'link-state'
          ? ', flood LSAs, and reroute as each LSA arrives.'
          : ', then reroute as updates spread.'}
      </p>
      <div className="mt-2 flex justify-between text-sm">
        <span className="text-slate-400">Links down</span>
        <span className="font-mono text-slate-100">{props.linksDown}</span>
      </div>
      {props.recentChanges.length > 0 && (
        <ul className="mt-2 space-y-1 text-xs text-slate-400">
          {props.recentChanges.map((change) => (
            <li key={change.id}>
              <span className="font-medium text-slate-200">{change.linkId}</span>{' '}
              {change.up ? 'restored' : 'cut'} at {(change.changedAt / 1000).toFixed(2)} s:{' '}
              {convergenceText(change)}
              <div className="font-mono text-[11px] text-slate-500">{metricsText(change)}</div>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

/** "detected 1000 ms · settled 1700 ms · 6 lost · 108 msgs", "so far" while converging. */
function metricsText(change: ConvergenceRecord): string {
  const parts: string[] = []
  if (change.detectionMs !== null) parts.push(`detected ${change.detectionMs} ms`)
  if (change.settledAt !== null) parts.push(`settled ${change.settledAt - change.changedAt} ms`)
  const soFar = change.settledAt === null ? ' so far' : ''
  parts.push(`${change.packetsLost} lost${soFar}`)
  parts.push(`${plural(change.controlMessagesSent, 'msg')}${soFar}`)
  return parts.join(' · ')
}

function convergenceText(change: ConvergenceRecord): string {
  if (change.settledAt === null)
    return change.detectedAt === null ? 'not noticed yet…' : 'rerouting…'
  return change.convergenceMs === null
    ? 'no route changed'
    : `converged in ${change.convergenceMs} ms`
}
