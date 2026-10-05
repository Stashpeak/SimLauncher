import { expect, test } from 'vitest'

import {
  buildLaunchFailureSentence,
  classifyLaunchFailure
} from '../../src/main/processes/launchFailures'
import type { LaunchFailureReason } from '../../src/main/processes/types'

// Measured on Electron 44.5.1 (ELECTRON_RUN_AS_NODE=1, child_process.spawn, no
// window) against the four #877 fixtures: a missing path, a text file
// renamed to .exe, an empty/truncated .exe, and an exe with a deny-execute
// ACL. See launchFailures.ts for why EACCES is listed too (never reached in
// practice, isElevatedLaunchError claims it first on win32, but mapped here
// for a non-win32 caller).
const measuredCodes: { code: string; reason: LaunchFailureReason }[] = [
  { code: 'ENOENT', reason: 'missing' },
  { code: 'UNKNOWN', reason: 'not_a_program' },
  { code: 'EFTYPE', reason: 'not_a_program' },
  { code: 'EPERM', reason: 'access_denied' },
  { code: 'EACCES', reason: 'access_denied' }
]

test.each(measuredCodes)('classifyLaunchFailure maps $code to $reason', ({ code, reason }) => {
  const err = Object.assign(new Error(`spawn ${code}`), { code })
  expect(classifyLaunchFailure(err)).toBe(reason)
})

test('classifyLaunchFailure falls back to unknown for an uncoded error', () => {
  expect(classifyLaunchFailure(new Error('spawn exploded'))).toBe('unknown')
})

test('classifyLaunchFailure falls back to unknown for a code it has never seen', () => {
  const err = Object.assign(new Error('spawn ETIMEDOUT'), { code: 'ETIMEDOUT' })
  expect(classifyLaunchFailure(err)).toBe('unknown')
})

test('classifyLaunchFailure falls back to unknown for a non-Error thrown value', () => {
  expect(classifyLaunchFailure('a plain string')).toBe('unknown')
  expect(classifyLaunchFailure(undefined)).toBe('unknown')
})

const allReasons: LaunchFailureReason[] = [
  'missing',
  'not_a_program',
  'access_denied',
  'elevation_failed',
  'unknown'
]

test.each(allReasons)(
  'buildLaunchFailureSentence(%s) never contains raw OS or PowerShell text',
  (reason) => {
    const sentence = buildLaunchFailureSentence(reason)

    // #877: the defect this issue fixes. None of these ever belongs in a
    // sentence built from a classified reason, because the reason is derived
    // from `err.code` alone and never touches `err.message`.
    expect(sentence).not.toContain('base64')
    expect(sentence).not.toContain('EncodedCommand')
    expect(sentence).not.toContain('CLIXML')
    expect(sentence).not.toContain('spawn ')
    expect(sentence.length).toBeGreaterThan(0)
    // `unknown` and `elevation_failed` are longer than the others: they
    // append a pointer to "Open logs folder" (#877's own Direction), since
    // those are the two reasons that otherwise tell the user nothing
    // specific about where the raw detail went.
    expect(sentence.length).toBeLessThan(140)
  }
)

test('buildLaunchFailureSentence never claims a declined UAC prompt for an elevation failure (#953)', () => {
  // #953 measured error.code === 1 for every elevated failure, decline or
  // genuine Windows error alike, nothing distinguishes them yet, so the
  // sentence must stay generic rather than asserting a decline that may not
  // have happened.
  const sentence = buildLaunchFailureSentence('elevation_failed')
  expect(sentence.toLowerCase()).not.toContain('declin')
  expect(sentence.toLowerCase()).not.toContain('cancel')
  expect(sentence.toLowerCase()).not.toContain('permission was requested')
})

test('buildLaunchFailureSentence gives every reason a distinct sentence', () => {
  const sentences = allReasons.map(buildLaunchFailureSentence)
  expect(new Set(sentences).size).toBe(allReasons.length)
})
