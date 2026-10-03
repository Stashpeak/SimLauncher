import { describe, expect, it } from 'vitest'
import {
  AUDIT_QUERY,
  DIST_TAGS_QUERY,
  evaluateRuntimeAudit,
  readNpmJson,
  retryUntilUsable
  // @ts-expect-error - plain .mjs repo tooling, no type declarations by design
} from '../../scripts/auditShippedRuntime.mjs'

/**
 * Guards the release gate on the shipped Electron runtime (#998).
 *
 * The rules are imported from the real script, and `evaluateRuntimeAudit` is
 * pure, so every case below is a small `npm audit --json` shaped object with
 * no npm, registry or lockfile involved. The shapes mirror real output: an
 * advisory against electron itself is an object in `via`, a vulnerable
 * dependency is a string naming it.
 */

type Result = {
  exitCode: 0 | 1 | 2
  errors: string[]
  unchecked: string[]
  unreadable: string[]
  warnings: string[]
  report: string[]
}

const advisory = (ghsa: string, severity = 'high', range = '>=42.0.0-alpha.1 <42.9.2') => ({
  source: 1239980,
  name: 'electron',
  dependency: 'electron',
  title: `advisory ${ghsa}`,
  url: `https://github.com/advisories/${ghsa}`,
  severity,
  range
})

// http-cache-semantics was flagged on main with no patched release when this
// gate was written (2026-10). Every case carries it, so a gate that looked at
// the whole tree would fail them all.
const unrelated = {
  'http-cache-semantics': {
    name: 'http-cache-semantics',
    severity: 'high',
    via: [advisory('GHSA-ch52-4w7c-c8xp')]
  }
}

const auditWith = (electronVia?: unknown[]) => ({
  auditReportVersion: 2,
  vulnerabilities: electronVia
    ? { ...unrelated, electron: { name: 'electron', severity: 'high', via: electronVia } }
    : { ...unrelated },
  metadata: {}
})

// The real tags on 2026-10-03: 44 is the newest stable major and 42.11.10 the
// newest 42.x.
const distTags = { latest: '44.5.1', '42-x-y': '42.11.10', '41-x-y': '41.10.7' }

const accept = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  reason: 'no webview anywhere in src',
  issue: 998,
  ...overrides
})

const run = (input: Record<string, unknown> = {}): Result =>
  evaluateRuntimeAudit({
    audit: auditWith(),
    electronVersion: '42.11.10',
    distTags,
    accepted: [],
    ...input
  })

describe('evaluateRuntimeAudit: advisories against electron', () => {
  it('passes a clean tree with nothing to say', () => {
    const result = run()
    expect(result.exitCode).toBe(0)
    expect(result.errors).toEqual([])
    expect(result.unchecked).toEqual([])
    expect(result.unreadable).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('fails on an advisory filed against electron itself', () => {
    const result = run({ audit: auditWith([advisory('GHSA-9qh4-3jw8-366w')]) })
    expect(result.exitCode).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('GHSA-9qh4-3jw8-366w')
  })

  it('passes the same advisory once it is accepted, and lists it in the report', () => {
    const result = run({
      audit: auditWith([advisory('GHSA-9qh4-3jw8-366w')]),
      accepted: [accept('GHSA-9qh4-3jw8-366w')]
    })
    expect(result.exitCode).toBe(0)
    expect(result.errors).toEqual([])
    // A matched entry is in use, so it must not also be called stale.
    expect(result.warnings).toEqual([])
    const listed = result.report.find((line) => line.includes('GHSA-9qh4-3jw8-366w'))
    expect(listed).toMatch(/^accepted:/)
    expect(listed).toContain('#998: no webview anywhere in src')
  })

  it('still fails on the advisories that are not accepted', () => {
    const result = run({
      audit: auditWith([advisory('GHSA-9qh4-3jw8-366w'), advisory('GHSA-hq2x-r82h-9wj4')]),
      accepted: [accept('GHSA-9qh4-3jw8-366w')]
    })
    expect(result.exitCode).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]).toContain('GHSA-hq2x-r82h-9wj4')
  })

  it('ignores advisories that reach electron only through a dependency', () => {
    const result = run({ audit: auditWith(['@electron/get']) })
    expect(result.exitCode).toBe(0)
    expect(result.errors).toEqual([])
    expect(result.report.join('\n')).toContain('@electron/get')
  })

  it('counts one advisory once when npm lists it for several ranges', () => {
    const result = run({
      audit: auditWith([advisory('GHSA-3wwx-pv8p-q78v'), advisory('GHSA-3wwx-pv8p-q78v')])
    })
    expect(result.errors).toHaveLength(1)
  })
})

describe('evaluateRuntimeAudit: the accepted-risk list', () => {
  it.each([
    ['no reason', { reason: undefined }],
    ['a blank reason', { reason: '   ' }],
    ['no issue', { issue: undefined }],
    ['an issue that is not a number', { issue: '#998' }],
    ['an id that is not a GHSA', { id: 'CVE-2026-15764' }]
  ])('fails on an entry with %s, even when nothing is reported', (_name, overrides) => {
    const result = run({ accepted: [accept('GHSA-9qh4-3jw8-366w', overrides)] })
    expect(result.exitCode).toBe(1)
    expect(result.errors[0]).toContain('runtime-audit-accepted.json')
  })

  it('does not let an invalid entry accept the advisory it names', () => {
    const result = run({
      audit: auditWith([advisory('GHSA-9qh4-3jw8-366w')]),
      accepted: [accept('GHSA-9qh4-3jw8-366w', { reason: '' })]
    })
    expect(result.exitCode).toBe(1)
    expect(result.errors.some((error) => error.includes('not accepted'))).toBe(true)
  })

  it('fails when the file holds no list at all', () => {
    expect(run({ accepted: undefined }).exitCode).toBe(1)
  })

  it('warns, without failing, about an entry that matches no reported advisory', () => {
    const result = run({ accepted: [accept('GHSA-9qh4-3jw8-366w')] })
    expect(result.exitCode).toBe(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('GHSA-9qh4-3jw8-366w')
    expect(result.warnings[0]).toContain('delete the entry')
  })
})

describe('evaluateRuntimeAudit: patch level and end of life', () => {
  it('warns, without failing, when electron is behind the newest patch of its major', () => {
    const result = run({ electronVersion: '42.4.0' })
    expect(result.exitCode).toBe(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('behind 42.11.10')
  })

  it('does not warn when the lockfile is ahead of a lagging dist-tag', () => {
    expect(run({ electronVersion: '42.11.11' }).warnings).toEqual([])
  })

  it('warns, without failing, once the major is past end of life', () => {
    // 45 stable makes 45, 44 and 43 the supported three.
    const result = run({ distTags: { ...distTags, latest: '45.0.0' } })
    expect(result.exitCode).toBe(0)
    expect(result.warnings).toHaveLength(1)
    expect(result.warnings[0]).toContain('Electron 42 is past end of life')
  })

  it('keeps the third-newest stable major supported', () => {
    // Off-by-one guard: 44 stable means 42 still gets fixes.
    expect(run().warnings).toEqual([])
    expect(run().report.join('\n')).toContain('Electron 42 is supported')
  })

  it('warns when npm has no dist-tag for the locked major', () => {
    const result = run({ distTags: { latest: '44.5.1' } })
    expect(result.exitCode).toBe(0)
    expect(result.warnings[0]).toContain('no 42-x-y dist-tag')
  })
})

// Captured verbatim from npm 11.4.2 on 2026-10-03 with the registry unreachable
// (`npm audit --json --registry http://127.0.0.1:9`), as #920 asked for: a real
// failing payload rather than one inferred from npm's source.
const realOutagePayload = {
  message:
    'request to http://127.0.0.1:9/-/npm/v1/security/advisories/bulk failed, reason: connect ECONNREFUSED 127.0.0.1:9',
  error: { summary: '', detail: '' }
}

describe('evaluateRuntimeAudit: could not check', () => {
  it.each([
    ['the real payload of an unreachable registry', realOutagePayload],
    ['a 503 from the advisories endpoint', { message: '503 Service Unavailable', error: {} }],
    ['output that was not JSON', readNpmJson('npm error audit endpoint returned an error')],
    ['an empty object', {}]
  ])('reports %s as an outage, never as a pass', (_name, audit) => {
    const result = run({ audit })
    expect(result.exitCode).toBe(2)
    expect(result.unchecked).toHaveLength(1)
    expect(result.unreadable).toEqual([])
  })

  // An answer npm will give again on a re-run: calling it an outage would send
  // the maintainer to re-run a check that can never pass.
  it.each([
    ['a report version it does not know', { auditReportVersion: 3, vulnerabilities: {} }],
    ['a report with no vulnerabilities map', { auditReportVersion: 2 }],
    [
      'an electron entry it cannot read',
      { auditReportVersion: 2, vulnerabilities: { electron: { via: 'odd' } } }
    ],
    [
      'an electron advisory with neither a GHSA url nor an npm advisory number',
      {
        auditReportVersion: 2,
        vulnerabilities: { electron: { via: [{ title: 'a', severity: 'high' }] } }
      }
    ]
  ])('reports %s as unreadable, not as an outage', (_name, audit) => {
    const result = run({ audit })
    expect(result.exitCode).toBe(2)
    expect(result.unchecked).toEqual([])
    expect(result.unreadable).toHaveLength(1)
    expect(result.unreadable[0]).toContain('re-running will not help')
  })

  it.each([
    ['no answer', undefined],
    ['an npm error', { error: { code: 'E404', summary: 'not found' } }],
    ['no latest tag', { '42-x-y': '42.11.10' }]
  ])('reports dist-tags with %s as could-not-check', (_name, tags) => {
    expect(run({ distTags: tags }).exitCode).toBe(2)
  })

  it('does not call every accepted entry stale when there is no report', () => {
    const result = run({ audit: undefined, accepted: [accept('GHSA-9qh4-3jw8-366w')] })
    expect(result.warnings).toEqual([])
  })

  it('lets a definite finding outrank an incomplete check', () => {
    const result = run({ audit: auditWith([advisory('GHSA-9qh4-3jw8-366w')]), distTags: undefined })
    expect(result.exitCode).toBe(1)
  })

  it('fails when the lockfile has no electron version to judge', () => {
    expect(run({ electronVersion: undefined }).exitCode).toBe(1)
  })
})

describe('retryUntilUsable', () => {
  const noSleep = async (): Promise<void> => {}

  it('retries an outage and returns the first usable answer', async () => {
    const answers = [undefined, { error: {} }, { ok: true }]
    let calls = 0
    const result = await retryUntilUsable(
      () => answers[calls++],
      (value: { ok?: boolean } | undefined) => value?.ok === true,
      { attempts: 3, sleep: noSleep }
    )
    expect(result).toEqual({ ok: true })
    expect(calls).toBe(3)
  })

  it('gives up after the last attempt and hands back what failed', async () => {
    let calls = 0
    const result = await retryUntilUsable(
      () => ({ attempt: ++calls }),
      () => false,
      { attempts: 3, sleep: noSleep }
    )
    expect(calls).toBe(3)
    expect(result).toEqual({ attempt: 3 })
  })
})

// Each flag below was measured on the 1.2.3 lockfile to turn six FAIL lines
// into a PASS when it is missing and the machine is configured the wrong way,
// with nothing else in the output looking different.
describe('the questions put to npm', () => {
  it('asks the audit about devDependencies, because electron is one', () => {
    // NODE_ENV=production or omit=dev drop electron from the report otherwise.
    expect(AUDIT_QUERY.args).toEqual(expect.arrayContaining(['audit', '--json', '--include=dev']))
  })

  it.each([
    ['npm audit', AUDIT_QUERY],
    ['npm view', DIST_TAGS_QUERY]
  ])('forces %s online, whatever npmrc says', (_name, query) => {
    // offline=true makes npm audit print a well-formed report with nothing in it.
    expect(query.args).toContain('--offline=false')
  })

  it('retries an audit outage', () => {
    expect(AUDIT_QUERY.isAnswer(realOutagePayload)).toBe(false)
    expect(AUDIT_QUERY.isAnswer(undefined)).toBe(false)
  })

  it('does not retry an audit report it cannot read, since npm would only repeat it', async () => {
    let calls = 0
    await retryUntilUsable(
      () => {
        calls++
        return { auditReportVersion: 3, vulnerabilities: {} }
      },
      AUDIT_QUERY.isAnswer,
      { attempts: 3, sleep: async (): Promise<void> => {} }
    )
    expect(calls).toBe(1)
  })
})
