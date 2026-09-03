import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
// @ts-expect-error - plain .mjs repo tooling, no type declarations by design
import { countCodeLines } from '../../scripts/countCodeLines.mjs'
// @ts-expect-error - plain .mjs repo tooling, no type declarations by design
import { evaluateBudget, toPosix } from '../../scripts/checkSizeBudget.mjs'

/**
 * Guards the code-line budget gate (#918).
 *
 * The rules are imported from the real script rather than restated here, so a
 * change to the gate cannot leave a green test describing behaviour that no
 * longer exists. `evaluateBudget` is pure for exactly this reason: the cases
 * below need no repo, no git and no filesystem.
 */

const count = (source: string, file = 'probe.ts'): number => countCodeLines(file, source).code

const config = {
  thresholdCodeLines: 300,
  budgets: { 'src/a.ts': 100 },
  exclusions: { 'src/data.ts': 'generated' }
}

// The base config names src/a.ts and src/data.ts, so both are present by
// default. A case that is about staleness passes its own file list instead.
const run = (
  files: string[],
  counts: Record<string, number>,
  overrides: Partial<typeof config> & { onlyTheseFiles?: boolean } = {}
): string[] => {
  const { onlyTheseFiles, ...configOverrides } = overrides
  const merged = { ...config, ...configOverrides }
  const referenced = onlyTheseFiles
    ? []
    : [...Object.keys(merged.budgets ?? {}), ...Object.keys(merged.exclusions ?? {})]

  return evaluateBudget({
    files: [...new Set([...referenced, ...files])],
    config: merged,
    codeLinesFor: (file: string) => counts[file] ?? 0
  })
}

describe('countCodeLines', () => {
  it('ignores blank lines and whole-line comments', () => {
    expect(count('const a = 1\n\n// a comment\nconst b = 2\n')).toBe(2)
  })

  it('counts a line holding code and a trailing comment as code', () => {
    expect(count('const a = 1 // explains a\n')).toBe(1)
  })

  it('ignores every line of a block comment', () => {
    expect(count('/**\n * one\n * two\n */\nconst a = 1\n')).toBe(1)
  })

  it('counts a line where code follows a block comment that ends on it', () => {
    expect(count('/* lead */ const a = 1\n')).toBe(1)
  })

  it('ignores JSX comments, which a regex counter reads as code', () => {
    const source = 'export const V = () => (\n  <div>\n    {/* why */}\n    <p />\n  </div>\n)\n'
    // Six lines, one of them a JSX comment.
    expect(count(source, 'probe.tsx')).toBe(5)
  })

  it('does not treat comment markers inside a template string as comments', () => {
    expect(count('const url = `https://x/y`\nconst c = `/* not a comment */`\n')).toBe(2)
  })

  it('does not treat a regex literal as the start of a comment', () => {
    // A bare ts.createScanner mis-lexes this and swallows the following lines.
    expect(count('const re = /https?:\\/\\//\nconst a = 1\nconst b = 2\n')).toBe(3)
  })

  it('counts CRLF the same as LF', () => {
    const lf = 'const a = 1\n// c\nconst b = 2\n'
    expect(count(lf.replace(/\n/g, '\r\n'))).toBe(count(lf))
  })

  it('throws rather than returning a wrong number for an unparseable file', () => {
    expect(() => count('const a = (((\n')).toThrow(/could not be parsed/)
  })
})

describe('evaluateBudget', () => {
  it('passes a tracked file sitting exactly on its budget', () => {
    expect(run(['src/a.ts'], { 'src/a.ts': 100 })).toEqual([])
  })

  it('fails a tracked file one line over its budget', () => {
    const [violation] = run(['src/a.ts'], { 'src/a.ts': 101 })
    expect(violation).toContain('grew past its budget')
    expect(violation).toContain('101 code lines, budget 100 (+1)')
  })

  it('passes a tracked file that shrank, and keeps tracking it', () => {
    // No lower bound by design: the downward ratchet was rejected on #918.
    expect(run(['src/a.ts'], { 'src/a.ts': 10 })).toEqual([])
  })

  it('fails a new file at the threshold with no entry', () => {
    const [violation] = run(['src/new.ts'], { 'src/new.ts': 300 })
    expect(violation).toContain('is new above the threshold')
    expect(violation).toContain('"src/new.ts": 300')
  })

  it('allows a new file below the threshold to stay unlisted', () => {
    expect(run(['src/new.ts'], { 'src/new.ts': 299 })).toEqual([])
  })

  it('skips an excluded file however large it is', () => {
    expect(run(['src/data.ts'], { 'src/data.ts': 5000 })).toEqual([])
  })

  it('fails a budget entry whose file is gone', () => {
    const violations = run([], {}, { onlyTheseFiles: true })
    expect(violations.some((v) => v.includes('stale budget entry: src/a.ts'))).toBe(true)
  })

  it('fails an exclusion whose file is gone', () => {
    const violations = run(['src/a.ts'], { 'src/a.ts': 100 }, { onlyTheseFiles: true })
    expect(violations.some((v) => v.includes('stale exclusion: src/data.ts'))).toBe(true)
  })

  it('fails a path that is both budgeted and excluded', () => {
    const violations = run(
      ['src/a.ts'],
      { 'src/a.ts': 100 },
      {
        exclusions: { 'src/a.ts': 'contradictory' }
      }
    )
    expect(violations.some((v) => v.includes('both budgeted and excluded'))).toBe(true)
  })

  it('reports every problem in one pass rather than stopping at the first', () => {
    const violations = run(
      ['src/a.ts', 'src/new.ts'],
      { 'src/a.ts': 400, 'src/new.ts': 350 },
      { onlyTheseFiles: true }
    )
    // over budget, new-over-threshold, and the now-stale exclusion
    expect(violations).toHaveLength(3)
    expect(violations.some((v) => v.includes('grew past its budget'))).toBe(true)
    expect(violations.some((v) => v.includes('is new above the threshold'))).toBe(true)
    expect(violations.some((v) => v.includes('stale exclusion'))).toBe(true)
  })

  it('rejects a non-integer threshold instead of silently passing everything', () => {
    expect(run(['src/a.ts'], { 'src/a.ts': 999 }, { thresholdCodeLines: 0 })[0]).toContain(
      'thresholdCodeLines'
    )
  })

  it('normalises Windows separators so both platforms agree', () => {
    expect(toPosix('src\\main\\store.ts')).toBe('src/main/store.ts')
    expect(run(['src\\a.ts'], { 'src/a.ts': 100 })).toEqual([])
  })
})

describe('the committed budget', () => {
  const budget = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../scripts/size-budget.json', import.meta.url)), 'utf8')
  )

  it('gives every exclusion a written reason', () => {
    for (const [file, reason] of Object.entries(budget.exclusions)) {
      expect(typeof reason, `${file} needs a reason`).toBe('string')
      expect((reason as string).length, `${file} needs a real reason`).toBeGreaterThan(20)
    }
  })

  it('uses forward slashes in every key, so the keys match on Windows', () => {
    const keys = [...Object.keys(budget.budgets), ...Object.keys(budget.exclusions)]
    expect(keys.filter((k) => k.includes('\\'))).toEqual([])
  })
})
