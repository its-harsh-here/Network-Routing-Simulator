export type NodeId = string
export type EdgeId = string

/**
 * An undirected link between nodes `a` and `b`. Edges are immutable: changing one (for
 * example with setEdgeUp) replaces the object, so an Edge you hold never changes under you.
 */
export interface Edge {
  readonly id: EdgeId
  readonly a: NodeId
  readonly b: NodeId
  /** Routing metric used by shortest-path algorithms. Must be > 0. */
  readonly cost: number
  /** Link capacity in bits per second. Must be > 0. */
  readonly bandwidthBps: number
  /** Propagation delay in milliseconds. Must be >= 0. */
  readonly delayMs: number
  /** False while the link is cut. */
  readonly up: boolean
}

/** Settings for addEdge. Anything left out comes from DEFAULT_EDGE or is generated (the id). */
export type EdgeOptions = Partial<Omit<Edge, 'a' | 'b'>>

/** Values used for edge settings that addEdge is not given: cost 1, 10 Mbps, 1 ms, up. */
export const DEFAULT_EDGE = {
  cost: 1,
  bandwidthBps: 10_000_000,
  delayMs: 1,
  up: true,
} as const

/** A neighbour of some node, and the edge that leads to it. */
export interface Neighbor {
  readonly node: NodeId
  readonly edge: Edge
}

/** Plain-object form of a Graph, as produced by toJSON() and read by fromJSON(). */
export interface GraphJSON {
  nodes: NodeId[]
  edges: Edge[]
}

/**
 * Undirected weighted graph stored as an adjacency list: for each node, a Map from neighbour id
 * to the edge between them. Each edge is stored under both endpoints and also in an index by
 * id, so looking an edge up by its endpoints or by its id is O(1).
 *
 * At most one edge joins any pair of nodes, and an edge cannot join a node to itself.
 * Nodes and edges are listed in the order they were added, which keeps results deterministic.
 */
export class Graph {
  private readonly adjacency = new Map<NodeId, Map<NodeId, Edge>>()
  private readonly edgesById = new Map<EdgeId, Edge>()
  private nextEdgeNumber = 1

  /** Number of nodes (V). Time: O(1). */
  get nodeCount(): number {
    return this.adjacency.size
  }

  /** Number of edges (E). Time: O(1). */
  get edgeCount(): number {
    return this.edgesById.size
  }

  /** True if the node exists. Time: O(1). */
  hasNode(id: NodeId): boolean {
    return this.adjacency.has(id)
  }

  /** Adds a node with no edges. Returns false if it already exists. Time: O(1). */
  addNode(id: NodeId): boolean {
    if (this.adjacency.has(id)) return false
    this.adjacency.set(id, new Map())
    return true
  }

  /**
   * Removes a node and every edge touching it. Returns false if the node does not exist.
   * Time: O(deg(node)). Each incident edge is deleted from the neighbour's map and the id index
   * in O(1).
   */
  removeNode(id: NodeId): boolean {
    const edges = this.adjacency.get(id)
    if (edges === undefined) return false
    for (const [neighbor, edge] of edges) {
      this.adjacency.get(neighbor)?.delete(id)
      this.edgesById.delete(edge.id)
    }
    this.adjacency.delete(id)
    return true
  }

  /**
   * Adds an edge between existing nodes `a` and `b` and returns it. Settings that are left out
   * come from DEFAULT_EDGE; a missing id is generated as "e1", "e2", ...
   * Time: O(1) amortised. Map lookups and inserts are O(1); generating an id may skip ids that
   * are already taken, but the counter only moves forward, so each id is skipped at most once.
   * @throws Error if a node does not exist, a === b, the nodes are already joined, or the id is
   *   taken. RangeError if cost, bandwidthBps or delayMs is out of range.
   */
  addEdge(a: NodeId, b: NodeId, options: EdgeOptions = {}): Edge {
    const fromA = this.adjacency.get(a)
    if (fromA === undefined) throw new Error(`Graph: unknown node "${a}"`)
    if (!this.adjacency.has(b)) throw new Error(`Graph: unknown node "${b}"`)
    if (a === b) throw new Error(`Graph: an edge cannot join "${a}" to itself`)
    const existing = fromA.get(b)
    if (existing !== undefined) {
      throw new Error(`Graph: "${a}" and "${b}" are already joined by edge "${existing.id}"`)
    }
    if (options.id !== undefined && this.edgesById.has(options.id)) {
      throw new Error(`Graph: edge id "${options.id}" is already used`)
    }

    const edge: Edge = {
      id: options.id ?? this.generateEdgeId(),
      a,
      b,
      cost: options.cost ?? DEFAULT_EDGE.cost,
      bandwidthBps: options.bandwidthBps ?? DEFAULT_EDGE.bandwidthBps,
      delayMs: options.delayMs ?? DEFAULT_EDGE.delayMs,
      up: options.up ?? DEFAULT_EDGE.up,
    }
    checkEdgeValues(edge)
    this.storeEdge(edge)
    return edge
  }

  /** Removes the edge with this id. Returns false if there is none. Time: O(1). */
  removeEdge(id: EdgeId): boolean {
    const edge = this.edgesById.get(id)
    if (edge === undefined) return false
    this.adjacency.get(edge.a)?.delete(edge.b)
    this.adjacency.get(edge.b)?.delete(edge.a)
    this.edgesById.delete(id)
    return true
  }

  /**
   * Marks an edge as up, or down (a cut link), and returns the updated edge. The edge object is
   * replaced rather than changed, so edges handed out earlier keep their old state.
   * Time: O(1).
   * @throws Error if no edge has this id.
   */
  setEdgeUp(id: EdgeId, up: boolean): Edge {
    const edge = this.edgesById.get(id)
    if (edge === undefined) throw new Error(`Graph: unknown edge "${id}"`)
    const updated: Edge = { ...edge, up }
    this.storeEdge(updated)
    return updated
  }

  /** Returns the edge with this id, or undefined. Time: O(1). */
  getEdge(id: EdgeId): Edge | undefined {
    return this.edgesById.get(id)
  }

  /** Returns the edge joining `a` and `b` (in either order), or undefined. Time: O(1). */
  edgeBetween(a: NodeId, b: NodeId): Edge | undefined {
    return this.adjacency.get(a)?.get(b)
  }

  /**
   * Lists the neighbours of `node`, each with the edge leading to it. With `onlyUp`, neighbours
   * reached only through a down edge are skipped.
   * Time: O(deg(node)).
   * @throws Error if the node does not exist.
   */
  neighbors(node: NodeId, { onlyUp = false }: { onlyUp?: boolean } = {}): Neighbor[] {
    const edges = this.adjacency.get(node)
    if (edges === undefined) throw new Error(`Graph: unknown node "${node}"`)
    const result: Neighbor[] = []
    for (const [neighbor, edge] of edges) {
      if (onlyUp && !edge.up) continue
      result.push({ node: neighbor, edge })
    }
    return result
  }

  /** All node ids, in the order they were added. Time: O(V). */
  nodes(): NodeId[] {
    return [...this.adjacency.keys()]
  }

  /** All edges, in the order they were added. Time: O(E). */
  edges(): Edge[] {
    return [...this.edgesById.values()]
  }

  /**
   * Returns an independent copy: changes to one graph do not affect the other. The Edge objects
   * themselves are shared, which is safe because they are immutable.
   * Time: O(V + E).
   */
  clone(): Graph {
    const copy = new Graph()
    for (const [node, edges] of this.adjacency) copy.adjacency.set(node, new Map(edges))
    for (const [id, edge] of this.edgesById) copy.edgesById.set(id, edge)
    copy.nextEdgeNumber = this.nextEdgeNumber
    return copy
  }

  /**
   * Returns a plain-object snapshot. JSON.stringify(graph) calls this automatically.
   * Time: O(V + E).
   */
  toJSON(): GraphJSON {
    return { nodes: this.nodes(), edges: this.edges() }
  }

  /**
   * Builds a graph from the output of toJSON(), checking it exactly as addNode and addEdge do.
   * Time: O(V + E).
   * @throws Error on a duplicate node or any edge that addEdge would reject.
   */
  static fromJSON(json: GraphJSON): Graph {
    const graph = new Graph()
    for (const node of json.nodes) {
      if (!graph.addNode(node)) throw new Error(`Graph: duplicate node "${node}" in JSON`)
    }
    for (const { a, b, ...options } of json.edges) {
      graph.addEdge(a, b, options)
    }
    return graph
  }

  /** Writes `edge` under both endpoints and in the id index, replacing any old version. O(1). */
  private storeEdge(edge: Edge): void {
    this.adjacency.get(edge.a)?.set(edge.b, edge)
    this.adjacency.get(edge.b)?.set(edge.a, edge)
    this.edgesById.set(edge.id, edge)
  }

  /** Returns the next unused id of the form "e<number>". O(1) amortised. */
  private generateEdgeId(): EdgeId {
    let id: EdgeId
    do {
      id = `e${this.nextEdgeNumber++}`
    } while (this.edgesById.has(id))
    return id
  }
}

/** Throws a RangeError if any numeric setting of `edge` is out of range. O(1). */
function checkEdgeValues(edge: Edge): void {
  if (!Number.isFinite(edge.cost) || edge.cost <= 0) {
    throw new RangeError(`Graph: edge "${edge.id}" cost must be > 0, got ${edge.cost}`)
  }
  if (!Number.isFinite(edge.bandwidthBps) || edge.bandwidthBps <= 0) {
    throw new RangeError(
      `Graph: edge "${edge.id}" bandwidthBps must be > 0, got ${edge.bandwidthBps}`,
    )
  }
  if (!Number.isFinite(edge.delayMs) || edge.delayMs < 0) {
    throw new RangeError(`Graph: edge "${edge.id}" delayMs must be >= 0, got ${edge.delayMs}`)
  }
}
