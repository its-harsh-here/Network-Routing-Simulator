import type { NodeId } from '../ds/Graph.ts'
import type { RouteEntry } from '../routing/types.ts'
import { PRIORITY_COLORS } from './colors.ts'
import {
  byName,
  type PacketInspection,
  type PathInspection,
  type RouterInspection,
} from './inspect.ts'
import RoutingTables from './RoutingTables.tsx'
import type { PickStep, RouteChange } from './useLiveSimulation.ts'

const BUTTON =
  'whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium ring-1 ring-slate-600 bg-slate-800 text-slate-100 hover:bg-slate-700'

/** "850 ms", "2.31 s". */
function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)} s` : `${Math.round(ms)} ms`
}

/**
 * One router: what it has done with packets, what is in its queues, and its routing table.
 * Render: O(V log V) to sort the router menu and the table, plus O(q) for q queued packets.
 */
export function RouterInspector(props: {
  router: NodeId
  inspection: RouterInspection | null
  tables: Record<NodeId, RouteEntry[]>
  changes: ReadonlyMap<string, RouteChange>
  onSelect: (router: NodeId) => void
}) {
  const { inspection } = props
  const routers = Object.keys(props.tables).sort(byName)
  return (
    <>
      <label className="flex items-center gap-2 text-xs text-slate-400">
        Router
        <select
          value={props.router}
          onChange={(event) => props.onSelect(event.target.value)}
          className="rounded-md bg-slate-800 px-2 py-1 text-sm text-slate-100 ring-1 ring-slate-700"
        >
          {routers.map((router) => (
            <option key={router} value={router}>
              {router}
            </option>
          ))}
        </select>
        <span className="text-slate-500">or click one on the map</span>
      </label>

      {inspection !== null && (
        <>
          <div className="mt-3 grid grid-cols-4 gap-1 text-center">
            {(
              [
                ['created', inspection.counters.originated],
                ['forwarded', inspection.counters.forwarded],
                ['delivered', inspection.counters.delivered],
                ['dropped', inspection.counters.dropped],
              ] as const
            ).map(([label, value]) => (
              <div
                key={label}
                className="rounded bg-slate-800/70 px-1 py-1 ring-1 ring-slate-700/60"
              >
                <div className="font-mono text-sm text-slate-100 tabular-nums">{value}</div>
                <div className="text-[10px] text-slate-400">{label}</div>
              </div>
            ))}
          </div>

          <h3 className="mt-3 mb-1 text-xs font-semibold text-slate-300">Output queues</h3>
          <ul className="space-y-1 text-xs">
            {inspection.queues.map((queue) => (
              <li key={queue.neighbour} className="flex items-center gap-2">
                <span className="w-24 shrink-0 text-slate-400">
                  → {queue.neighbour}
                  {!queue.linkUp && <span className="text-red-400"> (down)</span>}
                </span>
                <span className="w-9 shrink-0 font-mono text-slate-300 tabular-nums">
                  {queue.packets.length}/{queue.capacity}
                </span>
                <span className="flex flex-wrap gap-0.5" aria-label="queued packets, next first">
                  {queue.packets.map((packet) => (
                    <span
                      key={packet.id}
                      title={`#${packet.id} ${packet.priority} to ${packet.dst}`}
                      className="h-3 w-3 rounded-sm"
                      style={{ backgroundColor: PRIORITY_COLORS[packet.priority] }}
                    />
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[11px] text-slate-500">
            Squares are packets by class, next to be sent first (
            {inspection.queues[0]?.discipline ?? 'fifo'} queues).
          </p>
        </>
      )}

      <h3 className="mt-3 mb-1 text-xs font-semibold text-slate-300">Routing table</h3>
      <RoutingTables tables={props.tables} router={props.router} changes={props.changes} />
    </>
  )
}

/**
 * One packet's journey: drawn as a trail on the map, and described here.
 * Render: O(hops).
 */
export function PacketInspector(props: { inspection: PacketInspection; onClose: () => void }) {
  const p = props.inspection
  const rows: [string, string][] = [
    ['From → to', `${p.src} → ${p.dst}`],
    ['Now', p.location],
    ['Hops so far', `${p.hopCount}`],
    [p.status === 'delivered' || p.status === 'dropped' ? 'Lifetime' : 'Age', formatMs(p.ageMs)],
    ['TTL left', `${p.ttl}`],
    ['Size', `${p.sizeBytes} bytes`],
  ]
  return (
    <>
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-100">
          <span
            className="mr-2 inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: PRIORITY_COLORS[p.priority] }}
          />
          Packet #{p.id} <span className="font-normal text-slate-400">({p.priority})</span>
        </p>
        <button type="button" onClick={props.onClose} className={`${BUTTON} px-2 py-0.5 text-xs`}>
          Back to router
        </button>
      </div>
      <table className="mt-2 w-full text-xs">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label}>
              <td className="py-0.5 pr-2 text-slate-400">{label}</td>
              <td className="py-0.5 text-slate-100">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 font-mono text-xs break-words text-slate-300">{p.hops.join(' → ')}</p>
      <p className="mt-1 text-[11px] text-slate-500">
        The dotted white line on the map is its path so far.
      </p>
    </>
  )
}

/**
 * Pick two routers, then see the shortest path between them and where packets really go.
 * Render: O(path length).
 */
export function PathTool(props: {
  pickStep: PickStep
  picking: boolean
  pickedSource: NodeId | null
  path: PathInspection | null
  onPick: () => void
  onCancelPick: () => void
  onClear: () => void
}) {
  const { path } = props
  return (
    <>
      <div className="flex gap-2">
        {props.picking ? (
          <button type="button" onClick={props.onCancelPick} className={`${BUTTON} flex-1`}>
            {props.pickStep === 'source'
              ? 'Click router A…'
              : `A = ${props.pickedSource}: click B…`}{' '}
            (cancel)
          </button>
        ) : (
          <button type="button" onClick={props.onPick} className={`${BUTTON} flex-1`}>
            Pick A and B
          </button>
        )}
        {path !== null && !props.picking && (
          <button type="button" onClick={props.onClear} className={BUTTON}>
            Clear
          </button>
        )}
      </div>
      {path !== null && (
        <div className="mt-2 text-xs">
          {path.shortest === null ? (
            <p className="text-amber-300">
              No path: {path.to} cannot be reached from {path.from} with the links that are up.
            </p>
          ) : (
            <>
              <p className="text-slate-200">
                <span className="font-semibold">
                  {path.from} → {path.to}
                </span>
                : cost {formatCost(path.shortest.cost)}, {path.shortest.hops} hop
                {path.shortest.hops === 1 ? '' : 's'}
              </p>
              <p className="mt-1 font-mono break-words text-sky-300">
                {path.shortest.path.join(' → ')}
              </p>
            </>
          )}
          <p className={`mt-2 ${path.agrees ? 'text-emerald-300' : 'text-amber-300'}`}>
            {forwardingText(path)}
          </p>
        </div>
      )}
    </>
  )
}

/** What following the routers' next hops shows, in words. */
function forwardingText(path: PathInspection): string {
  const { forwarding } = path
  const route = forwarding.path.join(' → ')
  if (path.agrees) return 'The routers forward along a shortest path.'
  switch (forwarding.outcome) {
    case 'arrives':
      return `The routers still forward along ${route} (cost ${formatCost(forwarding.cost as number)}): the network has not converged yet. Dashed on the map.`
    case 'dead-link': {
      const [a, b] = forwarding.path.slice(-2)
      return `Packets go ${route}, but ${a}-${b} is down and ${a} has not noticed yet. Dashed on the map.`
    }
    case 'loop':
      return `Routing loop: ${route}. Packets go round until their TTL runs out.`
    case 'no-route':
      return `${forwarding.path[forwarding.path.length - 1]} has no route to ${path.to} (followed ${route}).`
  }
}

function formatCost(cost: number): string {
  return Number.isInteger(cost) ? String(cost) : cost.toFixed(1)
}
