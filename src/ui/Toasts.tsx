import type { Toast, ToastTone } from './useLiveSimulation.ts'

const TONES: Record<ToastTone, string> = {
  info: 'bg-slate-800 text-slate-100 ring-slate-600',
  success: 'bg-emerald-900/95 text-emerald-50 ring-emerald-600',
  warning: 'bg-amber-900/95 text-amber-50 ring-amber-600',
}

/**
 * Short notices in the bottom-right corner; each disappears after a few seconds.
 * Render: O(1): at most MAX_TOASTS toasts.
 */
export default function Toasts({
  toasts,
  onDismiss,
}: {
  toasts: Toast[]
  onDismiss: (id: number) => void
}) {
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-80 flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((toast) => (
        <button
          key={toast.id}
          type="button"
          onClick={() => onDismiss(toast.id)}
          className={`pointer-events-auto rounded-md px-3 py-2 text-left text-sm shadow-lg ring-1 ${TONES[toast.tone]}`}
        >
          {toast.text}
        </button>
      ))}
    </div>
  )
}
