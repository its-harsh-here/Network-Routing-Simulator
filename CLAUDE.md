# Real-Time Network Routing Simulator

Browser app: build a network of routers, send packets, watch hop-by-hop forwarding,
cut links and watch routing protocols reconverge live. Advanced DSA course project.

## Stack
Vite + React + TypeScript (strict), Tailwind CSS, HTML Canvas for the network view,
Recharts for charts, Vitest for tests.

## Commands
- npm run dev    start the app
- npm test       run all tests
- npm run build  type-check and build
- npm run sim    headless simulation runner (from phase 3)
- npm run bench  benchmarks (from phase 7)

## Folder map
src/ds        data structures: MinHeap, RingBuffer, Deque, UnionFind, Graph
src/algo      graph algorithms: dijkstra, bellmanFord, bfs, kruskal, tarjan
src/sim       discrete-event engine: EventQueue, Simulator, Router, Link, Packet, traffic, rng, stats
src/routing   routing protocols: linkState, distanceVector
src/topology  presets and JSON import/export
src/ui        React components and the canvas renderer
tests/        mirrors src/
bench/        benchmarks
docs/         write-ups, benchmark results

## Rules
- DSA course project: implement every data structure and algorithm ourselves.
  Never add libraries for graphs, heaps, queues or routing. Built-in Map, Set and arrays are fine.
- src/ds, src/algo, src/sim and src/routing must not import React or touch the DOM.
- All randomness goes through the seeded RNG in src/sim/rng.ts. Same seed = same results.
- Every public function has a JSDoc comment stating its time complexity.
- Every data structure and algorithm has unit tests: edge cases plus a randomized
  check against a simple reference implementation.
- Run npm test after each change and keep it green. Never call a task done with failing tests.
- Stay within the current task. Ask before adding any dependency.
- Prefer clear code over clever code: I must explain it in a viva.