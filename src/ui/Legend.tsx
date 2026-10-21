import { PRIORITIES } from '../sim/Packet.ts'
import {
  CONTROL_MESSAGE_COLOR,
  DOWN_LINK_COLOR,
  gradientCss,
  PRIORITY_COLORS,
  QUEUE_FILL_STOPS,
  UTILISATION_STOPS,
} from './colors.ts'

/**
 * Static key for the canvas colours, laid out in one row. It never re-renders.
 * Render: O(1).
 */
export default function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-slate-400">
      <span className="flex items-center gap-2">
        Packets
        {PRIORITIES.map((priority) => (
          <span key={priority} className="flex items-center gap-1 text-slate-300">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ backgroundColor: PRIORITY_COLORS[priority] }}
            />
            {priority}
          </span>
        ))}
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-2 w-2" style={{ backgroundColor: CONTROL_MESSAGE_COLOR }} />
        routing message
      </span>
      <Scale title="Link utilisation" background={gradientCss(UTILISATION_STOPS)} />
      <span className="flex items-center gap-1.5">
        <span
          className="inline-block w-5 border-t-2 border-dashed"
          style={{ borderColor: DOWN_LINK_COLOR }}
        />
        link down
      </span>
      <Scale title="Queue fill" background={gradientCss(QUEUE_FILL_STOPS)} />
    </div>
  )
}

function Scale({ title, background }: { title: string; background: string }) {
  return (
    <span className="flex items-center gap-1.5">
      {title}
      <span className="text-[10px]">0%</span>
      <span className="inline-block h-2 w-16 rounded-full" style={{ background }} />
      <span className="text-[10px]">100%</span>
    </span>
  )
}
