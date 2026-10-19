/** Top-level layout: header, network canvas area (left) and controls sidebar (right). */
export default function App() {
  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="border-b border-slate-800 px-6 py-4">
        <h1 className="text-xl font-semibold tracking-tight">Network Routing Simulator</h1>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex-1 p-4">
          <div className="flex h-full items-center justify-center rounded-lg border-2 border-dashed border-slate-700 text-slate-500">
            Network canvas
          </div>
        </main>

        <aside className="w-80 shrink-0 border-l border-slate-800 bg-slate-900 p-4">
          <h2 className="text-sm font-semibold tracking-wide text-slate-400 uppercase">Controls</h2>
          <p className="mt-2 text-sm text-slate-500">Simulation controls will go here.</p>
        </aside>
      </div>
    </div>
  )
}
