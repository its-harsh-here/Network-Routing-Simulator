import { byName } from './inspect.ts'
import AnalysisPanel from './AnalysisPanel.tsx'
import ComparisonPanel from './ComparisonPanel.tsx'
import {
  FailureControls,
  QueueControls,
  RoutingControls,
  Section,
  SimulationControls,
  TopologyControls,
  TrafficControls,
} from './Controls.tsx'
import EditorCanvas from './EditorCanvas.tsx'
import EditorPanel from './EditorPanel.tsx'
import EventLogPanel from './EventLogPanel.tsx'
import { PacketInspector, PathTool, RouterInspector } from './Inspector.tsx'
import LiveCharts from './LiveCharts.tsx'
import NetworkCanvas from './NetworkCanvas.tsx'
import { NO_CHART } from './panel.ts'
import { LIVE_SIM_CONFIG } from './simulation.ts'
import StatsCards from './StatsCards.tsx'
import Toasts from './Toasts.tsx'
import TopologyFiles from './TopologyFiles.tsx'
import { useLiveSimulation } from './useLiveSimulation.ts'
import { useTopologyEditor } from './useTopologyEditor.ts'

/**
 * Top-level layout: header, the network view (left), controls, stats and inspectors (right),
 * toasts. In edit mode the left shows the editor canvas and the right the editor panel.
 * Render: O(V log V) to sort the router names, plus the sections.
 */
export default function App() {
  const live = useLiveSimulation()
  const { actions, panel, settings } = live
  const editor = useTopologyEditor((message) => actions.notify(message, 'warning'))

  const routers = live.simulation.topology.graph.nodes().sort(byName)
  const inspectedRouter =
    live.inspectedRouter !== null && routers.includes(live.inspectedRouter)
      ? live.inspectedRouter
      : (routers[0] ?? null)
  const pickPrompt =
    live.pickStep === 'source'
      ? `Click the ${live.pickPurpose === 'path' ? 'first router (A)' : 'source router'} (Esc to cancel)`
      : live.pickStep === 'destination'
        ? `From ${live.pickedSource}: click the ${live.pickPurpose === 'path' ? 'second router (B)' : 'destination router'}`
        : null

  const startEditing = () => {
    actions.beginEditing()
    editor.start(live.design())
  }
  const finishEditing = () => {
    actions.endEditing(editor.changed ? editor.draft : null)
    editor.stop()
  }
  const cancelEditing = () => {
    actions.endEditing(null)
    editor.stop()
  }

  return (
    <div className="flex h-screen flex-col bg-slate-950 text-slate-100">
      <header className="flex items-baseline gap-3 border-b border-slate-800 px-6 py-3">
        <h1 className="text-xl font-semibold tracking-tight">Network Routing Simulator</h1>
        <span className="text-sm text-slate-500">
          {editor.draft !== null
            ? `Editing "${editor.draft.name}"`
            : `${live.simulation.topology.name}, ${live.simulation.topology.graph.nodeCount} routers, ${live.simulation.sim.routing.name}`}
        </span>
      </header>

      <div className="flex min-h-0 flex-1">
        <main className="flex min-w-0 flex-1 flex-col gap-3 p-4">
          {editor.draft !== null ? (
            <EditorCanvas
              draft={editor.draft}
              selection={editor.selection}
              linkMode={editor.linkMode}
              onLinkModeChange={editor.actions.setLinkMode}
              onAddRouter={editor.actions.addRouter}
              onMoveRouter={editor.actions.moveRouter}
              onAddLink={editor.actions.addLink}
              onSelect={editor.actions.select}
            />
          ) : (
            <>
              <div className="min-h-0 flex-1">
                <NetworkCanvas
                  simulation={live.simulation}
                  speed={live.speed}
                  paused={live.paused}
                  pickPrompt={pickPrompt}
                  selectedRouter={live.pickedSource}
                  highlightPacketId={live.inspectedPacket?.id ?? live.trackedPacket?.id ?? null}
                  inspectedRouter={live.inspectedPacket === null ? inspectedRouter : null}
                  inspectedPacket={live.inspectedPacket}
                  pathEnds={live.pathEnds}
                  overlays={live.overlays}
                  broadcast={live.broadcast}
                  onRouterClick={actions.handleRouterClick}
                  onLinkClick={actions.handleLinkClick}
                  onPacketClick={actions.handlePacketClick}
                  onPanelUpdate={actions.handlePanelUpdate}
                  onEdit={startEditing}
                />
              </div>
              <LiveCharts chart={panel?.chart ?? NO_CHART} />
            </>
          )}
        </main>

        <aside className="w-96 shrink-0 overflow-y-auto border-l border-slate-800 bg-slate-900">
          {editor.draft !== null ? (
            <Section title="Edit topology">
              <EditorPanel
                draft={editor.draft}
                changed={editor.changed}
                selection={editor.selection}
                actions={editor.actions}
                onDone={finishEditing}
                onCancel={cancelEditing}
              />
            </Section>
          ) : (
            <>
              <Section title="Simulation">
                <SimulationControls
                  simTimeMs={panel?.simTimeMs ?? null}
                  paused={live.paused}
                  speed={live.speed}
                  seed={settings.seed}
                  lastEvent={live.lastEvent}
                  onTogglePause={actions.togglePause}
                  onStep={actions.step}
                  onReset={actions.reset}
                  onSpeedChange={actions.setSpeed}
                  onSeedChange={actions.changeSeed}
                />
              </Section>
              <Section title="Stats">
                <StatsCards data={panel} />
              </Section>
              <Section
                title={live.inspectedPacket !== null ? 'Packet inspector' : 'Router inspector'}
              >
                {live.inspectedPacket !== null && panel?.inspector.packet ? (
                  <PacketInspector
                    inspection={panel.inspector.packet}
                    onClose={actions.closePacketInspector}
                  />
                ) : inspectedRouter !== null ? (
                  <RouterInspector
                    router={inspectedRouter}
                    inspection={panel?.inspector.router ?? null}
                    tables={panel?.tables ?? {}}
                    changes={live.routeChanges}
                    onSelect={actions.setInspectedRouter}
                  />
                ) : (
                  <p className="text-xs text-slate-500">No routers.</p>
                )}
                <p className="mt-3 text-[11px] text-slate-500">
                  Click a router or a packet on the map to inspect it (pause first to catch a packet
                  easily).
                </p>
              </Section>
              <Section title="Shortest path">
                <PathTool
                  pickStep={live.pickStep}
                  picking={live.pickStep !== 'off' && live.pickPurpose === 'path'}
                  pickedSource={live.pickedSource}
                  path={panel?.inspector.path ?? null}
                  onPick={() => actions.startPick('path')}
                  onCancelPick={actions.cancelPick}
                  onClear={actions.clearPath}
                />
              </Section>
              <Section title="Analysis">
                <AnalysisPanel
                  analysis={panel?.analysis ?? null}
                  overlays={live.overlays}
                  onOverlaysChange={actions.setOverlays}
                  routers={routers}
                  defaultSource={inspectedRouter}
                  broadcast={live.broadcast}
                  paused={live.paused}
                  onBroadcast={actions.startBroadcast}
                />
              </Section>
              <Section title="Event log">
                <EventLogPanel entries={panel?.log ?? []} />
              </Section>
              <Section title="Traffic">
                <TrafficControls
                  packetsPerSecond={settings.packetsPerSecond}
                  priorityMix={settings.priorityMix}
                  pickStep={live.pickPurpose === 'send' ? live.pickStep : 'off'}
                  pickedSource={live.pickedSource}
                  sendPriority={live.sendPriority}
                  onRateChange={actions.changeRate}
                  onMixChange={actions.changeMix}
                  onStartPick={() => actions.startPick('send')}
                  onCancelPick={actions.cancelPick}
                  onSendPriorityChange={actions.setSendPriority}
                />
              </Section>
              <Section title="Routing">
                <RoutingControls
                  routing={settings.routing}
                  control={panel?.control ?? null}
                  onProtocolChange={actions.changeProtocol}
                  onOptionChange={actions.changeRoutingOption}
                />
              </Section>
              <Section title="Queues (QoS)">
                <QueueControls
                  discipline={settings.queueDiscipline}
                  queueCapacity={LIVE_SIM_CONFIG.queueCapacity}
                  onChange={actions.changeQueueDiscipline}
                />
              </Section>
              <Section title="Failures">
                <FailureControls
                  linksDown={panel?.linksDown ?? 0}
                  recentChanges={panel?.recentChanges ?? []}
                  protocol={panel?.protocol ?? settings.routing.protocol}
                />
              </Section>
              <Section title="Protocol comparison">
                <ComparisonPanel
                  settings={live.runningSettings}
                  network={live.runningNetwork}
                  links={live.simulation.topology.graph.edges().map((edge) => edge.id)}
                />
              </Section>
              <Section title="Topology">
                <TopologyControls
                  settings={settings.topology}
                  onChange={actions.changeTopology}
                  onLoad={actions.load}
                />
                <div className="mt-4 border-t border-slate-800 pt-3">
                  <p className="mb-2 text-xs text-slate-400">
                    Or build one by hand with <span className="text-slate-200">Edit topology</span>{' '}
                    above the map, and save or load it as a file:
                  </p>
                  <TopologyFiles current={live.design} onLoad={actions.loadNetwork} />
                </div>
              </Section>
            </>
          )}
        </aside>
      </div>

      <Toasts toasts={live.toasts} onDismiss={actions.dismissToast} />
    </div>
  )
}
