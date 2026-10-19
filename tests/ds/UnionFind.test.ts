import { describe, expect, it } from 'vitest'
import { UnionFind } from '../../src/ds/UnionFind.ts'
import { Rng } from '../../src/sim/rng.ts'

describe('UnionFind', () => {
  it('starts with every element in its own set', () => {
    const sets = new UnionFind(['a', 'b', 'c'])
    expect(sets.size).toBe(3)
    expect(sets.setCount).toBe(3)
    expect(sets.find('a')).toBe('a')
    expect(sets.connected('a', 'b')).toBe(false)
  })

  it('can start empty', () => {
    const sets = new UnionFind<string>()
    expect(sets.size).toBe(0)
    expect(sets.setCount).toBe(0)
  })

  it('handles a single element', () => {
    const sets = new UnionFind(['only'])
    expect(sets.find('only')).toBe('only')
    expect(sets.connected('only', 'only')).toBe(true)
    expect(sets.union('only', 'only')).toBe(false)
    expect(sets.setCount).toBe(1)
  })

  it('union joins two sets, and returns false if they are already joined', () => {
    const sets = new UnionFind(['a', 'b', 'c'])
    expect(sets.union('a', 'b')).toBe(true)
    expect(sets.setCount).toBe(2)
    expect(sets.connected('a', 'b')).toBe(true)
    expect(sets.find('a')).toBe(sets.find('b'))

    expect(sets.union('b', 'a')).toBe(false)
    expect(sets.union('a', 'b')).toBe(false)
    expect(sets.setCount).toBe(2)
  })

  it('connected is transitive', () => {
    const sets = new UnionFind([1, 2, 3, 4])
    sets.union(1, 2)
    sets.union(2, 3)
    expect(sets.connected(1, 3)).toBe(true)
    expect(sets.connected(1, 4)).toBe(false)
    expect(sets.union(1, 3)).toBe(false)
    expect(sets.setCount).toBe(2)
  })

  it('add creates a new single-element set and rejects duplicates', () => {
    const sets = new UnionFind(['a'])
    expect(sets.add('b')).toBe(true)
    expect(sets.add('b')).toBe(false)
    expect(sets.has('b')).toBe(true)
    expect(sets.has('z')).toBe(false)
    expect(sets.setCount).toBe(2)
  })

  it('ignores duplicate elements given to the constructor', () => {
    const sets = new UnionFind([1, 1, 2])
    expect(sets.size).toBe(2)
    expect(sets.setCount).toBe(2)
  })

  it('throws for elements that were never added', () => {
    const sets = new UnionFind(['a'])
    expect(() => sets.find('z')).toThrow('unknown element')
    expect(() => sets.union('a', 'z')).toThrow('unknown element')
    expect(() => sets.connected('z', 'a')).toThrow('unknown element')
  })

  it('handles one long chain of unions', () => {
    const n = 10_000
    const sets = new UnionFind(Array.from({ length: n }, (_, i) => i))
    for (let i = 0; i + 1 < n; i++) expect(sets.union(i, i + 1)).toBe(true)
    expect(sets.setCount).toBe(1)
    expect(sets.connected(0, n - 1)).toBe(true)
  })

  describe('randomized', () => {
    it('matches a relabelling reference implementation', () => {
      const n = 200
      const rng = new Rng(31337)
      const sets = new UnionFind(Array.from({ length: n }, (_, i) => i))
      // Reference: label[i] names i's set. union relabels a whole set in O(n): slow but obvious.
      const label = Array.from({ length: n }, (_, i) => i)

      for (let step = 0; step < 2_000; step++) {
        const a = rng.int(0, n - 1)
        const b = rng.int(0, n - 1)
        if (rng.next() < 0.5) {
          const oldLabel = label[b]
          const merged = label[a] !== oldLabel
          if (merged) {
            for (let i = 0; i < n; i++) if (label[i] === oldLabel) label[i] = label[a]
          }
          expect(sets.union(a, b)).toBe(merged)
        } else {
          expect(sets.connected(a, b)).toBe(label[a] === label[b])
        }
        expect(sets.setCount).toBe(new Set(label).size)
      }
    })
  })
})
