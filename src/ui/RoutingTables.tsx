import type { NodeId } from '../ds/Graph.ts'
import type { RouteEntry } from '../routing/types.ts'
import { byName } from './inspect.ts'
import { routeKey, type RouteChange } from './useLiveSimulation.ts'

/** Networks this small show every router's table at once. */
const SHOW_ALL_UP_TO = 4

interface Props {
  tables: Record<NodeId, RouteEntry[]>
  /** The router whose table to show. */
  router: NodeId
  /** Entries that changed a moment ago, by routeKey. */
  changes: ReadonlyMap<string, RouteChange>
}

/**
 * Routing tables, with entries that just changed highlighted: the chosen router's, or every
 * router's in a small network.
 * Render: O(V log V) to sort the router names and the entries.
 */
export default function RoutingTables({ tables, router, changes }: Props) {
  const routers = Object.keys(tables).sort(byName)
  if (routers.length === 0) return <p className="text-xs text-slate-500">No routers.</p>
  const shown = routers.length <= SHOW_ALL_UP_TO ? routers : routers.filter((r) => r === router)
  return (
    <div className="space-y-3">
      {shown.map((id) => (
        <Table key={id} router={id} entries={tables[id]} changes={changes} />
      ))}
    </div>
  )
}

function Table({
  router,
  entries,
  changes,
}: {
  router: NodeId
  entries: RouteEntry[]
  changes: ReadonlyMap<string, RouteChange>
}) {
  const rows = [...entries].sort((a, b) => byName(a.destination, b.destination))
  return (
    <table className="w-full text-xs">
      <caption className="mb-1 text-left font-semibold text-slate-200">Router {router}</caption>
      <thead>
        <tr className="text-slate-500">
          <th className="py-0.5 text-left font-normal">To</th>
          <th className="py-0.5 text-left font-normal">Next hop</th>
          <th className="py-0.5 text-right font-normal">Cost</th>
        </tr>
      </thead>
      <tbody className="font-mono">
        {rows.map((entry) => {
          const change = changes.get(routeKey(router, entry.destination))
          return (
            <tr
              key={entry.destination}
              className={`transition-colors duration-500 ${change ? 'bg-amber-400/25' : ''}`}
            >
              <td className="py-0.5 text-slate-200">{entry.destination}</td>
              <td className="py-0.5 text-slate-300">{entry.nextHop ?? '-'}</td>
              <td
                className={`py-0.5 text-right ${entry.reachable ? 'text-slate-100' : 'text-red-400'}`}
              >
                {change?.previousCost !== null && change?.previousCost !== undefined && (
                  <span className="mr-1 text-slate-500">{formatCost(change.previousCost)} →</span>
                )}
                {entry.reachable ? formatCost(entry.cost) : `${formatCost(entry.cost)} ∞`}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** Whole numbers as they are; anything else with one decimal. */
function formatCost(cost: number): string {
  return Number.isInteger(cost) ? String(cost) : cost.toFixed(1)
}
