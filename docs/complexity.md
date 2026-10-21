# Complexity and design choices

Every data structure and algorithm in the simulator is written from scratch (no graph, heap,
queue or routing libraries). This page lists each one with its time and space complexity, where
it is used, and why it was chosen over the alternatives. V is the number of routers, E the
number of links, n the number of items in a structure. "Amortised" means averaged over a
sequence of operations. Measured numbers are in [benchmarks.md](benchmarks.md).

## Data structures (`src/ds`)

### MinHeap — binary heap in an array

| operation                 | time            | notes                                      |
| ------------------------- | --------------- | ------------------------------------------ |
| `push`                    | O(log n)        | append a leaf, sift up one level at a time |
| `pop`                     | O(log n)        | last leaf to the root, sift down           |
| `peek`, `size`, `isEmpty` | O(1)            |                                            |
| `remove(matches)`         | O(n) + O(log n) | linear search, then one sift up or down    |
| `toArray`                 | O(n)            | a copy, in heap order                      |

Space: O(n), one array, no pointers.

Used by: the event queue, Dijkstra, priority packet queues, the broadcast simulation.

Why: a heap gives O(log n) for both insert and remove-min. A **sorted array** has O(1) pop but
O(n) insert (shifting); an **unsorted array** has O(1) insert but O(n) pop. The simulator does
about as many inserts as pops, so the heap's balanced O(log n) wins: n operations cost
O(n log n) instead of O(n²). A **balanced BST** also gives O(log n) but needs node objects and
rotations; a **Fibonacci heap** has better amortised bounds for decrease-key, but large
constants and much more code, and lazy deletion (below) removes the need for decrease-key. An
array-backed heap stores no pointers: a parent is at (i − 1) / 2, children at 2i + 1 and 2i + 2.

### RingBuffer — fixed-capacity circular queue

| operation                                      | time        |
| ---------------------------------------------- | ----------- |
| `enqueue`, `dequeue`, `peek`, `size`, `isFull` | O(1)        |
| iteration, oldest to newest                    | O(n)        |
| construction                                   | O(capacity) |

Space: O(capacity), allocated once.

Modes: **drop-tail** (a full buffer rejects new items: a router's FIFO queue) and **overwrite**
(a new item replaces the oldest: stats time series and the event log).

Why, for router queues: a router's queue is bounded by definition, so a fixed array is
natural, and "full" is the drop-tail rule for free. A **JavaScript array** with `shift()` is
O(n) per dequeue. A **linked list** is O(1) but allocates a node per packet (garbage to
collect at tens of thousands of packets per second) and chases pointers. The ring buffer
allocates nothing after construction and keeps items next to each other in memory.

Why, for history: overwrite mode keeps "the last 300 samples" or "the last 200 events" in fixed
memory however long the simulation runs, with O(1) per sample.

### Deque — growable circular array

| operation                              | time                               |
| -------------------------------------- | ---------------------------------- |
| `pushBack`, `pushFront`                | O(1) amortised (doubles when full) |
| `popBack`, `popFront`, `peek*`, `size` | O(1)                               |

Space: O(n), at most about twice the largest size it has held.

Used by: BFS's queue, and the stats collector's sliding latency window (new deliveries are
pushed at the back, deliveries older than the window are popped from the front).

Why: the window needs O(1) at both ends. `Array.shift()` is O(n). A ring buffer has a fixed
capacity, but the number of deliveries in a 5-second window depends on the traffic. A doubling
array gives O(1) amortised: the O(n) copy on growth happens after n cheap pushes.

### MonotonicDeque — sliding-window maximum

| operation                     | time                                                              |
| ----------------------------- | ----------------------------------------------------------------- |
| `push`                        | O(1) amortised: each value is pushed once and popped at most once |
| `max`, `evictBefore`          | O(1) amortised                                                    |
| `slidingWindowMax(values, w)` | O(n) total                                                        |

Space: O(w).

Used by: tests only, as a data-structure exercise for course phase 2. Nothing in the app uses it yet.

Why: the naive maximum of every window is O(n·w); a heap with lazy deletion is O(n log n). The
monotonic deque keeps only values that could still become the maximum, in decreasing order, so
the front is always the maximum.

### UnionFind — disjoint sets with path compression and union by rank

| operation                    | time                                                |
| ---------------------------- | --------------------------------------------------- |
| `find`, `union`, `connected` | O(α(n)) amortised; O(log n) worst case for one call |
| `setCount`                   | O(1) (a counter)                                    |
| construction                 | O(n)                                                |

Space: O(n): parent and rank per element.

Used by: Kruskal's cycle check, and the editor's "the network is in N parts" warning.

Why, for Kruskal: an edge closes a cycle exactly when its ends are already connected. Checking
that with a **BFS or DFS** costs O(V + E) per edge, O(E · (V + E)) in total. Union-find answers
it in O(α(V)), practically constant (α(n) ≤ 4 for any n that fits in memory), so the cycle
checks cost O(E α(V)) in total and the sort dominates. Path compression flattens trees on every
find; union by rank keeps them O(log n) deep even before compression.

### Graph — undirected weighted adjacency list

| operation                                                              | time           |
| ---------------------------------------------------------------------- | -------------- |
| `addNode`, `hasNode`, `addEdge`, `getEdge`, `edgeBetween`, `setEdgeUp` | O(1) amortised |
| `removeEdge`                                                           | O(1)           |
| `removeNode`                                                           | O(deg)         |
| `neighbors(node)`                                                      | O(deg)         |
| `nodes`, `edges`, `clone`, `toJSON`, `fromJSON`                        | O(V + E)       |

Space: O(V + E): `Map<NodeId, Map<NodeId, Edge>>` plus an index of edges by id.

Why: networks are sparse (a router has a handful of links). An **adjacency matrix** costs
O(V²) space and O(V) to list a router's neighbours: 400 MB of entries for 20,000 routers. A
plain **edge list** needs O(E) to find a router's links. Nested Maps give O(deg) neighbours and
O(1) "is there a link between a and b" for routing and validation. Edges are immutable: changing
one (cutting a link) replaces the object, so an Edge held by a snapshot never changes under it.

## Graph algorithms (`src/algo`)

All of them ignore links that are down.

| algorithm                                | time                    | space          | used for                                                     |
| ---------------------------------------- | ----------------------- | -------------- | ------------------------------------------------------------ |
| Dijkstra, binary heap with lazy deletion | O((V + E) log V)        | O(V + E)       | link-state routes, forwarding tables, the shortest-path tool |
| Dijkstra, naive (linear scan)            | O(V² + E)               | O(V)           | benchmark baseline only                                      |
| Bellman-Ford                             | O(V · E)                | O(V)           | reference for Dijkstra in tests; negative-cycle detection    |
| BFS                                      | O(V + E)                | O(V)           | hop counts, connectivity, "missing routes" in the comparison |
| Kruskal's MST                            | O(E log E) = O(E log V) | O(V + E)       | MST overlay, broadcast tree, mesh preset                     |
| Tarjan's bridges and articulation points | O(V + E)                | O(V)           | weak-spot overlay, non-bridge failures in the benchmarks     |
| path reconstruction (`pathTo`)           | O(path length)          | O(path length) |                                                              |
| forwarding table from `prev`             | O(V)                    | O(V)           | next hop for every destination                               |

**Dijkstra with lazy deletion.** Instead of decrease-key, a shorter distance pushes a new heap
entry, and stale entries (a distance larger than the best known) are skipped when popped. There
are at most E pushes, so the heap holds O(E) entries and each operation costs O(log E) =
O(log V), since E ≤ V². This keeps the plain array heap: **decrease-key** needs an index
from node to heap position, updated on every swap. A **Fibonacci heap** gives
O(E + V log V) in theory, but its constant factors make it slower in practice at these
sizes. The **naive O(V²)** version wins only on dense graphs (E close to V²); on sparse
graphs the gap grows with V (measured in [benchmarks.md](benchmarks.md)).

**Bellman-Ford** is O(V · E), much slower than Dijkstra, but it handles negative costs, detects
negative cycles, and is the algorithm distance-vector routing distributes (each router relaxes
its neighbours' vectors). Tests check Dijkstra against it and against a Floyd-Warshall helper on
200 random graphs, and check distance-vector's converged routes against Dijkstra on 50.

**Kruskal over Prim**: both are O(E log V) on sparse graphs. Kruskal (sort the links, keep those
union-find says join two parts) handles a disconnected network naturally, giving a spanning
forest, where Prim would need a restart per part. It is also simpler to explain.

**Tarjan over brute force**: a single DFS records discovery times and low-links, so a link is a
bridge if low[child] > disc[parent], all in O(V + E). The brute force (remove each link and test
connectivity) is O(E · (V + E)). The DFS is iterative, with an explicit stack, so a
20,000-router line does not overflow the call stack.

## Simulation engine (`src/sim`)

| piece                                      | time                    | space                    | notes                                                |
| ------------------------------------------ | ----------------------- | ------------------------ | ---------------------------------------------------- |
| EventQueue (`schedule`, `next`)            | O(log n)                | O(n)                     | MinHeap ordered by (time, sequence number)           |
| Simulator `step`                           | O(log n) + the handler  |                          | one event                                            |
| `runUntil(t)`                              | O(k log n) for k events |                          |                                                      |
| forwarding a packet at a router            | O(1)                    |                          | next hop from the protocol, enqueue in a ring buffer |
| cutting a link                             | O(P + C)                |                          | drops the P packets and C routing messages on it     |
| stats sample                               | O(V + E)                | O(maxSamples) per series | ring buffers in overwrite mode                       |
| latency window stats (avg, p95, per class) | O(w log w)              | O(w)                     | w deliveries in the window; sort for percentiles     |
| seeded RNG (mulberry32)                    | O(1) per number         | O(1)                     | same seed, same run                                  |
| event log                                  | O(1) per entry          | O(200)                   | ring buffer in overwrite mode                        |

**Event queue: heap keyed by (time, sequence).** See MinHeap for heap against sorted array.
The sequence number breaks ties between events at the same time in scheduling order. A heap is
not stable on its own, and without the tie-break two runs could order simultaneous events
differently, which would break "same seed, same results". Events that become irrelevant (a
transmission on a link that was cut, an old traffic timer) are not searched for and removed:
each carries enough to recognise it as stale when it is popped (**lazy deletion**, as in
Dijkstra). That is O(1) per cancelled event instead of an O(n) search.

**Router queues.** FIFO queues are drop-tail ring buffers (see RingBuffer). Priority queues
(QoS) are a MinHeap keyed by (class, arrival sequence): O(log n) to add or send. When a priority
queue is full, it scans for the lowest-class, newest packet to drop: O(n), but n is the queue
capacity (8 to 32 packets), so this is cheap. A **min-max heap** would make that eviction
O(log n) at the cost of much more code. With only three classes, **three FIFO queues** would
also work in O(1); the heap generalises to any number of classes or keys.

**Percentiles.** p95 is computed exactly, by sorting the window: O(w log w). **Quickselect**
would be O(w) on average; a **histogram or t-digest** would be approximate. The window holds a
few seconds of deliveries and is computed four times a second, so the exact sort is simple and
fast enough.

## Routing (`src/routing`)

| piece                                 | time                                                        | messages                                                        |
| ------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------- |
| link-state: start                     | O(V (V + E) log V): one Dijkstra per router                 | none                                                            |
| link-state: one link change           | O(deg) to originate, one Dijkstra per router per new LSA    | each LSA crosses each link direction at most once: O(E) per LSA |
| link-state: receiving k LSAs          | O(k) to check sequence numbers, plus Dijkstra if any is new | forwards new ones to all neighbours but the sender              |
| distance-vector: recompute one router | O(deg · V)                                                  | one triggered update per neighbour if it changed                |
| distance-vector: periodic update      | O(V) per message                                            | deg messages per router per period                              |
| convergence detection (QuietDetector) | O(1) per activity                                           |                                                                 |
| broadcast simulation                  | O(M log M) for M copies                                     | tree: V − 1; flooding: 2E − V + 1                               |

**Link-state flooding with sequence numbers.** Each router keeps the newest LSA from every origin
and forwards an LSA only the first time it sees that sequence number. A router accepts each LSA
once and passes it to its other neighbours, so a flood costs O(E) messages and always
terminates. A link counts as up only if both ends' LSAs say so (the two-way check), so a
half-updated database cannot route over a dead link. Each router recomputes with Dijkstra on its
own database, instead of a central computation, as real OSPF routers do.

**Distance-vector (RIP-like).** Each router stores its neighbours' vectors and recomputes in
O(deg · V). Infinity is 16, so a count to infinity ends after at most about 16 rounds. Split
horizon and poison reverse are switches, to show the problem and its fixes. The
comparison and the benchmarks show the costs: periodic updates even when nothing changes, and
destinations 16 or more hops away become unreachable.

**Convergence detection.** Link-state has converged when no LSA is in flight (a counter, O(1)).
Distance-vector has converged after a full update period with no route change. That is a timer
that re-arms itself; it treats less than 1 µs of remaining time as zero, because a timer that
re-arms with a delay too small to change the clock would never end.

**Broadcast: MST against flooding.** Both are simulated with a MinHeap of arrivals ordered by
time. Flooding with duplicate suppression sends deg(source) + Σ(deg − 1) = 2E − V + 1 copies, of
which V − 1 are useful, but it reaches every router by the fastest path, because it explores
every path. A spanning tree sends exactly V − 1, one per tree link, with no duplicates, but its
paths can be longer. Tests check flooding's arrival times against Dijkstra on link delays.

## Topology and UI (`src/topology`, `src/ui`)

| piece                                       | time                                  | notes                                     |
| ------------------------------------------- | ------------------------------------- | ----------------------------------------- |
| editor operations (add, move, link, delete) | O(V + E) each (moving a router: O(V)) | return a new topology instead of mutating |
| topology file: save, validate and load      | O(V + E)                              | every problem reported with its position  |
| hit-testing a click or hover                | O(V + E + P)                          | nearest router, then packet, then link    |
| drawing a frame                             | O(V + E + P)                          | P packets on links                        |
| analysis overlays (MST, bridges)            | O(E log E + V + E)                    | recomputed only when a link changes state |
| protocol comparison                         | two full simulations                  | in a Web Worker, off the UI thread        |

**Immutable edits over mutation.** Copying the topology on every edit costs O(V + E), which is
microseconds for a network built by hand. In return, React sees a new object and redraws, and an
old draft is never changed under the canvas. Undo would be a stack of old drafts.

**Linear hit-testing over a spatial index.** A quadtree or grid would answer "what is under the
pointer" in about O(log n), but the network has at most a few hundred routers and links, and
hit-testing runs once per pointer event, so a linear scan is far below a frame's budget and has
no index to keep up to date as packets move.

**Recomputing overlays only on change.** Kruskal and Tarjan are cheap, but there is no reason to
run them 60 times a second. The simulator counts link state changes, and the canvas recomputes
only when that count moves, so an overlay updates the moment a link is cut.
