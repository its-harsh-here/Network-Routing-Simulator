import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// CLAUDE.md rule: the core layers must stay independent of React.
const CORE_DIRS = ['src/ds', 'src/algo', 'src/sim', 'src/routing']
const PROJECT_ROOT = join(import.meta.dirname, '..')

/** Lists every .ts file under `dir`, recursively. O(n) in the number of entries. */
function tsFilesIn(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => join(dir, file))
}

describe('core layers', () => {
  it.each(CORE_DIRS)('%s does not import React', (dir) => {
    const files = tsFilesIn(join(PROJECT_ROOT, dir))
    expect(files.length).toBeGreaterThan(0)

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      expect(source, file).not.toMatch(/from\s+['"]react(-dom)?(\/|['"])/)
    }
  })
})
