/**
 * Disjoint-set forest (union-find). Each set is a tree whose root is the set's representative;
 * `parent` maps every element to its parent, and a root is its own parent.
 *
 * - Union by rank: when two trees merge, the shorter one goes under the taller one, so a tree
 *   with rank r has at least 2^r elements and height at most log2 n.
 * - Path compression: find() points every element it passes straight at the root, so later
 *   finds on them take one step.
 *
 * Together they make find and union O(α(n)) amortised, where α is the inverse Ackermann
 * function. α(n) <= 4 for any n that fits in memory, so in practice this is constant time.
 */
export class UnionFind<T> {
  private readonly parent = new Map<T, T>()
  /** Upper bound on the height of the tree under each root. Only roots' ranks are used. */
  private readonly rank = new Map<T, number>()
  private sets = 0

  /** Creates a structure with each of `elements` in its own set. Time: O(n). */
  constructor(elements: Iterable<T> = []) {
    for (const element of elements) this.add(element)
  }

  /** Number of elements. Time: O(1). */
  get size(): number {
    return this.parent.size
  }

  /** Number of disjoint sets. Time: O(1): kept as a counter that union() decrements. */
  get setCount(): number {
    return this.sets
  }

  /** True if `element` has been added. Time: O(1). */
  has(element: T): boolean {
    return this.parent.has(element)
  }

  /** Adds `element` as a new single-element set. Returns false if it already exists. Time: O(1). */
  add(element: T): boolean {
    if (this.parent.has(element)) return false
    this.parent.set(element, element)
    this.rank.set(element, 0)
    this.sets++
    return true
  }

  /**
   * Returns the representative (root) of the set containing `element`.
   * Time: O(α(n)) amortised; O(log n) worst case for a single call, thanks to union by rank.
   * @throws Error if `element` was never added.
   */
  find(element: T): T {
    if (!this.parent.has(element)) {
      throw new Error(`UnionFind: unknown element ${String(element)}`)
    }
    return this.findRoot(element)
  }

  /**
   * Merges the sets containing `a` and `b`. Returns false if they were already in the same set.
   * Time: O(α(n)) amortised: two finds plus O(1) linking.
   * @throws Error if `a` or `b` was never added.
   */
  union(a: T, b: T): boolean {
    const rootA = this.find(a)
    const rootB = this.find(b)
    if (rootA === rootB) return false

    const rankA = this.rank.get(rootA) as number
    const rankB = this.rank.get(rootB) as number
    if (rankA < rankB) {
      this.parent.set(rootA, rootB)
    } else if (rankA > rankB) {
      this.parent.set(rootB, rootA)
    } else {
      // Equal heights: either can go on top, and the merged tree is one level taller.
      this.parent.set(rootB, rootA)
      this.rank.set(rootA, rankA + 1)
    }
    this.sets--
    return true
  }

  /**
   * True if `a` and `b` are in the same set. Time: O(α(n)) amortised.
   * @throws Error if `a` or `b` was never added.
   */
  connected(a: T, b: T): boolean {
    return this.find(a) === this.find(b)
  }

  /**
   * Follows parents up to the root, then points each element on the way directly at it
   * (path compression). The recursion depth is at most the tree height, which union by rank
   * keeps at O(log n).
   */
  private findRoot(element: T): T {
    const parent = this.parent.get(element) as T
    if (parent === element) return element
    const root = this.findRoot(parent)
    this.parent.set(element, root)
    return root
  }
}
