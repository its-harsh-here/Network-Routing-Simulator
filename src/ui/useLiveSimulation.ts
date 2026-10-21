import { useCallback, useEffect, useRef, useState } from 'react'
import type { EdgeId, NodeId } from '../ds/Graph.ts'
import { DistanceVectorRouting } from '../routing/distanceVector.ts'
import type { ProtocolName } from '../routing/types.ts'
import { PRIORITIES, type Packet, type Priority } from '../sim/Packet.ts'
import type { BroadcastStrategy } from '../routing/broadcast.ts'
import type { QueueDiscipline } from '../sim/queues.ts'
import { withAllLinksUp } from '../topology/edit.ts'
import { topologyToFile, type TopologyFile } from '../topology/json.ts'
import type { Topology } from '../topology/presets.ts'
import { isTypingTarget } from './canvasInput.ts'
import { planBroadcast, type BroadcastDemo, type OverlayToggles } from './analysis.ts'
import type { PanelData } from './panel.ts'
import {
  COUNT_TO_INFINITY_SETTINGS,
  createSimulation,
  DEFAULT_LIVE_SETTINGS,
  DEFAULT_SPEED,
  describeChange,
  describePacket,
  simulationFor,
  toggleLink,
  type LiveSettings,
  type RoutingSettings,
  type Simulation,
  type TopologySource,
  type TopologySettings,
} from './simulation.ts'

export type ToastTone = 'info' | 'success' | 'warning'

export interface Toast {
  id: number
  text: string
  tone: ToastTone
}

/** Where we are in picking two routers: not picking, picking the first, or the second. */
export type PickStep = 'off' | 'source' | 'destination'
/** What the two routers are picked for: a packet to send, or the shortest-path tool. */
export type PickPurpose = 'send' | 'path'

/** How long a toast stays on screen. */
const TOAST_MS = 5_000
/** At most this many toasts are shown at once; older ones make way. */
const MAX_TOASTS = 4

/** How long a changed routing-table entry stays highlighted, in real time. */
const ROUTE_HIGHLIGHT_MS = 1_500

/** A route that changed recently: the key is routeKey(router, destination). */
export interface RouteChange {
  /** The cost before the change, or null if the entry is new. */
  previousCost: number | null
}

/** Key for one routing-table entry. O(1). */
export function routeKey(router: NodeId, destination: NodeId): string {
  return `${router}>${destination}`
}

/** True if at least one traffic class has a positive weight. O(1). */
export function isValidMix(mix: Record<Priority, number>): boolean {
  return PRIORITIES.some((priority) => mix[priority] > 0)
}

/**
 * State and actions behind the controls: the current simulation, play/pause/step/reset, speed,
 * settings, the routing protocol, router picking (for manual packets and the path tool), link
 * toggling, the inspectors, entering and leaving edit mode, loading networks, and toasts.
 * The canvas reports panel data through handlePanelUpdate a few times a second; that is also
 * where finished convergence and finished manual packets turn into toasts, and where changed
 * routing-table entries are spotted for highlighting.
 * Most actions are O(1). Load, Reset and switching protocol or queues rebuild the simulation, O(V (V + E) log V) for the routing tables. Each panel update diffs the routing tables in O(V²).
 */
export function useLiveSimulation() {
  const [settings, setSettings] = useState<LiveSettings>(DEFAULT_LIVE_SETTINGS)
  /** The network the current simulation was built from (Reset rebuilds this one). */
  const [source, setSource] = useState<TopologySource>({
    kind: 'preset',
    settings: DEFAULT_LIVE_SETTINGS.topology,
  })
  const [simulation, setSimulation] = useState<Simulation>(() => createSimulation())
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(DEFAULT_SPEED)
  const [panel, setPanel] = useState<PanelData | null>(null)
  const [lastEvent, setLastEvent] = useState<string | null>(null)
  const [pickStep, setPickStep] = useState<PickStep>('off')
  const [pickPurpose, setPickPurpose] = useState<PickPurpose>('send')
  const [pickedSource, setPickedSource] = useState<NodeId | null>(null)
  const [sendPriority, setSendPriority] = useState<Priority>('video')
  const [trackedPacket, setTrackedPacket] = useState<Packet | null>(null)
  const [toasts, setToasts] = useState<Toast[]>([])
  /** The router in the router inspector, or null for the first one. */
  const [inspectedRouter, setInspectedRouter] = useState<NodeId | null>(null)
  /** The packet in the packet inspector (the simulator's own object, which it keeps updating). */
  const [inspectedPacket, setInspectedPacket] = useState<Packet | null>(null)
  /** The two routers of the shortest-path tool. */
  const [pathEnds, setPathEnds] = useState<{ from: NodeId; to: NodeId } | null>(null)
  /** True while the topology editor is open: the simulation is paused and keys are the editor's. */
  const [editing, setEditing] = useState(false)
  /** Whether the simulation was paused when editing began, to go back to that afterwards. */
  const pausedBeforeEditing = useRef(false)
  const [overlays, setOverlays] = useState<OverlayToggles>({ mst: false, weakSpots: false })
  /** The broadcast being played on the map, with its tree and flooding results. */
  const [broadcast, setBroadcast] = useState<BroadcastDemo | null>(null)
  const [routeChanges, setRouteChanges] = useState<ReadonlyMap<string, RouteChange>>(new Map())
  /** Last seen cost and next hop of every routing-table entry, and when it last changed. */
  const routeMemory = useRef(
    new Map<
      string,
      { cost: number; nextHop: NodeId | null; previousCost: number | null; changedAt: number }
    >(),
  )
  /** Link changes of the current simulation that already had a toast. */
  const notifiedChanges = useRef(new Set<number>())
  /** The manually sent packet we are waiting on, read by the panel callback. */
  const trackedRef = useRef<Packet | null>(null)
  const nextToastId = useRef(1)

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const pushToast = useCallback(
    (text: string, tone: ToastTone = 'info') => {
      const id = nextToastId.current++
      setToasts((current) => [...current.slice(-(MAX_TOASTS - 1)), { id, text, tone }])
      setTimeout(() => dismissToast(id), TOAST_MS)
    },
    [dismissToast],
  )

  const cancelPick = () => {
    setPickStep('off')
    setPickedSource(null)
  }

  /**
   * Replaces the simulation with a fresh one of `network`, built from the settings (with
   * `overrides` applied and kept). Returns false if it could not be built.
   */
  const rebuild = (network: TopologySource, overrides: Partial<LiveSettings> = {}): boolean => {
    const nextSettings = { ...settings, ...overrides, topology: settings.topology }
    let next: Simulation
    try {
      next = simulationFor(network, nextSettings)
    } catch (error) {
      pushToast(`Could not build the simulation: ${(error as Error).message}`, 'warning')
      return false
    }
    setSettings(nextSettings)
    setSimulation(next)
    setSource(network)
    setPanel(null)
    setLastEvent(null)
    cancelPick()
    trackedRef.current = null
    setTrackedPacket(null)
    notifiedChanges.current = new Set()
    routeMemory.current = new Map()
    setRouteChanges(new Map())
    setInspectedRouter(null)
    setInspectedPacket(null)
    setPathEnds(null)
    setBroadcast(null)
    return true
  }

  const reset = () => {
    rebuild(source)
  }

  /** Loads the topology form. The count-to-infinity preset brings its own routing and traffic. */
  const load = () => {
    const preset: TopologySource = { kind: 'preset', settings: settings.topology }
    if (settings.topology.preset !== 'count-to-infinity') {
      rebuild(preset)
      return
    }
    if (rebuild(preset, COUNT_TO_INFINITY_SETTINGS)) {
      pushToast(
        'Distance-vector with split horizon and poison reverse off. Cut link B-C and watch the cost to C.',
        'info',
      )
    }
  }

  /** Switching protocol restarts the current topology with the new protocol. */
  const changeProtocol = (protocol: ProtocolName) => {
    if (protocol === settings.routing.protocol) return
    if (rebuild(source, { routing: { ...settings.routing, protocol } })) {
      pushToast(`Restarted with ${protocol} routing`, 'info')
    }
  }

  /** Switching queue discipline restarts the current topology with the new queues. */
  const changeQueueDiscipline = (queueDiscipline: QueueDiscipline) => {
    if (queueDiscipline === settings.queueDiscipline) return
    if (rebuild(source, { queueDiscipline })) {
      pushToast(`Restarted with ${queueDiscipline === 'fifo' ? 'FIFO' : 'priority'} queues`, 'info')
    }
  }

  /** Split horizon and poison reverse apply to the running distance-vector routers at once. */
  const changeRoutingOption = (option: 'splitHorizon' | 'poisonReverse', value: boolean) => {
    const routing: RoutingSettings = { ...settings.routing, [option]: value }
    setSettings((s) => ({ ...s, routing }))
    if (simulation.sim.routing instanceof DistanceVectorRouting) {
      simulation.sim.routing.setOptions({ [option]: value })
    }
  }
  const togglePause = () => setPaused((current) => !current)

  /** Pauses and processes exactly one event. */
  const step = () => {
    setPaused(true)
    const next = simulation.sim.step()
    setLastEvent(
      next === undefined
        ? 'No events left'
        : `${next.event.type} at ${(next.time / 1000).toFixed(3)} s`,
    )
  }

  const changeTopology = (topology: TopologySettings) => setSettings((s) => ({ ...s, topology }))
  const changeSeed = (seed: number) => setSettings((s) => ({ ...s, seed }))

  /** Traffic changes apply to the running simulation at once (and to later Loads and Resets). */
  const changeRate = (packetsPerSecond: number) => {
    setSettings((s) => ({ ...s, packetsPerSecond }))
    if (isValidMix(settings.priorityMix)) {
      simulation.sim.setTraffic(packetsPerSecond, settings.priorityMix)
    }
  }

  const changeMix = (priorityMix: Record<Priority, number>) => {
    setSettings((s) => ({ ...s, priorityMix }))
    if (isValidMix(priorityMix)) simulation.sim.setTraffic(settings.packetsPerSecond, priorityMix)
  }

  /** Starts picking two routers: for a packet to send, or for the shortest-path tool. */
  const startPick = (purpose: PickPurpose = 'send') => {
    setPickPurpose(purpose)
    setPickStep('source')
    setPickedSource(null)
  }

  const handleRouterClick = (id: NodeId) => {
    if (pickStep === 'off') {
      setInspectedRouter(id) // open the router inspector on this router
      setInspectedPacket(null)
    } else if (pickStep === 'source') {
      setPickedSource(id)
      setPickStep('destination')
    } else if (pickStep === 'destination' && pickedSource !== null) {
      if (id === pickedSource) {
        pushToast('Pick a router different from the first one', 'warning')
        return
      }
      if (pickPurpose === 'path') {
        setPathEnds({ from: pickedSource, to: id })
      } else {
        const packet = simulation.sim.sendPacket(pickedSource, id, { priority: sendPriority })
        trackedRef.current = packet
        setTrackedPacket(packet)
        setInspectedPacket(packet) // and follow it in the packet inspector
      }
      cancelPick()
    }
  }

  const handleLinkClick = (id: EdgeId) => toggleLink(simulation, id)

  /** Opens the packet inspector on a packet that was clicked on the map. */
  const handlePacketClick = (id: number) => {
    const packet = simulation.sim.findPacket(id)
    if (packet !== undefined) setInspectedPacket(packet)
  }

  /** The running network as designed, every link up: what Save writes and the editor starts from. */
  const design = (): Topology => withAllLinksUp(simulation.topology)

  /** Runs a network built in the editor or loaded from a file. */
  const loadNetwork = (topology: Topology) => {
    if (rebuild({ kind: 'custom', topology })) {
      const { nodeCount, edgeCount } = topology.graph
      pushToast(`Loaded "${topology.name}": ${nodeCount} routers, ${edgeCount} links`, 'success')
    }
  }

  /**
   * Broadcasts from `source` over the network as it is now: plays it on the map (along the MST,
   * or by flooding) and works out both, for the comparison.
   */
  const startBroadcast = (source: NodeId, shown: BroadcastStrategy = 'tree') => {
    const { sim } = simulation
    setBroadcast(planBroadcast(sim.graph, source, sim.now, shown))
  }

  /** Pauses the simulation for editing. */
  const beginEditing = () => {
    pausedBeforeEditing.current = paused
    setPaused(true)
    cancelPick()
    setEditing(true)
  }

  /**
   * Leaves edit mode. A changed network replaces the simulation (new routers and routing
   * tables); otherwise the old one carries on. Either way it plays again if it was playing.
   */
  const endEditing = (changed: Topology | null) => {
    setEditing(false)
    if (changed !== null) loadNetwork(changed)
    setPaused(pausedBeforeEditing.current)
  }

  // Called by the canvas a few times a second, outside React rendering.
  const handlePanelUpdate = useCallback(
    (data: PanelData) => {
      setPanel(data)
      for (const change of data.recentChanges) {
        if (change.settledAt === null || notifiedChanges.current.has(change.id)) continue
        notifiedChanges.current.add(change.id)
        pushToast(describeChange(change), change.up ? 'success' : 'warning')
      }
      // Spot routing-table entries that changed since the last update, and keep them
      // highlighted for a moment. Nothing is highlighted on the first update of a simulation.
      const memory = routeMemory.current
      const firstUpdate = memory.size === 0
      const wallNow = performance.now()
      const recent = new Map<string, RouteChange>()
      for (const [router, entries] of Object.entries(data.tables)) {
        for (const entry of entries) {
          const key = routeKey(router, entry.destination)
          const seen = memory.get(key)
          if (seen === undefined) {
            const changedAt = firstUpdate ? -Infinity : wallNow
            memory.set(key, {
              cost: entry.cost,
              nextHop: entry.nextHop,
              previousCost: null,
              changedAt,
            })
          } else if (seen.cost !== entry.cost || seen.nextHop !== entry.nextHop) {
            memory.set(key, {
              cost: entry.cost,
              nextHop: entry.nextHop,
              previousCost: seen.cost,
              changedAt: wallNow,
            })
          }
          const latest = memory.get(key) as { previousCost: number | null; changedAt: number }
          if (wallNow - latest.changedAt < ROUTE_HIGHLIGHT_MS) {
            recent.set(key, { previousCost: latest.previousCost })
          }
        }
      }
      setRouteChanges(recent)

      const packet = trackedRef.current
      const outcome = packet === null ? null : describePacket(packet)
      if (packet !== null && outcome !== null) {
        pushToast(outcome, packet.status === 'delivered' ? 'success' : 'warning')
        trackedRef.current = null
        setTrackedPacket(null)
      }
    },
    [pushToast],
  )

  // Keyboard shortcuts: space = play/pause, s = step, r = reset, Escape = stop picking. Off
  // while editing, where the editor has keys of its own.
  const shortcuts = useRef({ togglePause, step, reset, cancelPick, editing })
  useEffect(() => {
    shortcuts.current = { togglePause, step, reset, cancelPick, editing }
  })
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || isTypingTarget(event.target)) return
      if (shortcuts.current.editing) return
      const key = event.key.toLowerCase()
      if (key === ' ') {
        event.preventDefault() // no page scroll, and no click on a focused button
        if (!event.repeat) shortcuts.current.togglePause()
      } else if (key === 's') {
        shortcuts.current.step()
      } else if (key === 'r' && !event.repeat) {
        shortcuts.current.reset()
      } else if (key === 'escape') {
        shortcuts.current.cancelPick()
      }
    }
    // A focused button is "clicked" when Space is released, so cancel that too.
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ' && !isTypingTarget(event.target)) event.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  /**
   * The settings of what is running now, for the protocol comparison: the loaded preset and the
   * seed it was built with (the forms may already hold different ones), or the custom network.
   */
  const runningSettings: LiveSettings = {
    ...settings,
    topology: source.kind === 'preset' ? source.settings : settings.topology,
    seed: simulation.sim.config.seed,
  }
  const runningNetwork: TopologyFile | null =
    source.kind === 'custom' ? topologyToFile(source.topology) : null

  return {
    settings,
    runningSettings,
    runningNetwork,
    simulation,
    paused,
    speed,
    panel,
    lastEvent,
    pickStep,
    pickPurpose,
    pickedSource,
    sendPriority,
    trackedPacket,
    toasts,
    inspectedRouter,
    inspectedPacket,
    pathEnds,
    overlays,
    broadcast,
    editing,
    routeChanges,
    design,
    actions: {
      togglePause,
      step,
      reset,
      load,
      setSpeed,
      changeSeed,
      changeTopology,
      changeRate,
      changeMix,
      startPick,
      cancelPick,
      setSendPriority,
      handleRouterClick,
      handleLinkClick,
      handlePanelUpdate,
      dismissToast,
      changeProtocol,
      changeQueueDiscipline,
      changeRoutingOption,
      setInspectedRouter,
      closePacketInspector: () => setInspectedPacket(null),
      clearPath: () => setPathEnds(null),
      handlePacketClick,
      setOverlays,
      startBroadcast,
      loadNetwork,
      beginEditing,
      endEditing,
      notify: pushToast,
    },
  }
}
