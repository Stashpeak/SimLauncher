import type { ChildProcess } from 'child_process'
import { beforeEach, expect, test } from 'vitest'

import {
  abortActiveLaunches,
  consumeProcessNameMismatchWarningSuppression,
  dismissAppIcon,
  gamesSeenRunning,
  getLaunchGeneration,
  getUnclosedProcessKey,
  isLaunchActiveForGame,
  processNameMismatchWarnings,
  pruneExpiredProcessNameMismatchWarnings,
  pruneStoppedRunningProcesses,
  registerActiveLaunch,
  runningProcesses,
  suppressProcessNameMismatchWarning,
  suppressedProcessNameMismatchWarnings,
  unclosedProcesses,
  unregisterActiveLaunch
} from '../../src/main/processes/state'
import { normalizePathForComparison } from '../../src/main/utils'

function runningEntry(appPath: string) {
  return {
    process: {} as ChildProcess,
    path: appPath,
    name: appPath.split(/[\\/]/).pop()!,
    gameKey: 'iracing',
    isGame: false
  }
}

function unclosedEntry(appPath: string) {
  return {
    path: appPath,
    name: appPath.split(/[\\/]/).pop()!,
    gameKey: 'iracing',
    error: 'still running',
    reason: 'still_running' as const
  }
}

beforeEach(() => {
  runningProcesses.clear()
  unclosedProcesses.clear()
  processNameMismatchWarnings.clear()
  suppressedProcessNameMismatchWarnings.clear()
})

test('pruneStoppedRunningProcesses drops only entries whose exe is no longer running', () => {
  runningProcesses.set('a', runningEntry('C:/Tools/SimHub.exe'))
  runningProcesses.set('b', runningEntry('C:/Tools/CrewChief.exe'))

  pruneStoppedRunningProcesses(new Set(['simhub.exe']))

  expect(runningProcesses.has('a')).toBe(true)
  expect(runningProcesses.has('b')).toBe(false)
})

test('pruneExpiredProcessNameMismatchWarnings removes only expired entries', () => {
  const now = 1_000_000
  const warning = { path: 'C:/Tools/App.exe', name: 'App.exe', gameKey: 'iracing', warning: 'w' }
  processNameMismatchWarnings.set('expired', { ...warning, expiresAt: now - 1 })
  processNameMismatchWarnings.set('expiring-now', { ...warning, expiresAt: now })
  processNameMismatchWarnings.set('future', { ...warning, expiresAt: now + 1 })
  processNameMismatchWarnings.set('no-ttl', warning)

  pruneExpiredProcessNameMismatchWarnings(now)

  expect([...processNameMismatchWarnings.keys()]).toEqual(['future', 'no-ttl'])
})

test('getUnclosedProcessKey lowercases bare process names instead of resolving them to cwd', () => {
  // A bare name resolved via normalizePathForComparison would get the
  // launcher's cwd prefixed, making the key unstable across working dirs.
  expect(getUnclosedProcessKey('iracing', '', 'Foo.exe')).toBe('iracing:foo.exe')
  expect(getUnclosedProcessKey('iracing', 'Foo.exe', 'foo.exe')).toBe('iracing:foo.exe')
  expect(getUnclosedProcessKey(undefined, '', 'Foo.exe')).toBe('unknown:foo.exe')
})

test('getUnclosedProcessKey canonicalises full paths like every other comparison site', () => {
  expect(getUnclosedProcessKey('iracing', 'C:\\Apps\\Foo.exe', 'foo.exe')).toBe(
    `iracing:${normalizePathForComparison('c:/apps/FOO.EXE')}`
  )
})

test('mismatch-warning suppression is consume-once and separator/case-insensitive', () => {
  suppressProcessNameMismatchWarning('C:/Apps/Foo.exe')

  expect(consumeProcessNameMismatchWarningSuppression('c:\\apps\\FOO.EXE')).toBe(true)
  expect(consumeProcessNameMismatchWarningSuppression('C:/Apps/Foo.exe')).toBe(false)
})

test('dismissAppIcon clears both the mismatch warning and the unclosed entry for the app', () => {
  const appPath = 'C:\\Apps\\Foo.exe'
  processNameMismatchWarnings.set(normalizePathForComparison(appPath), {
    path: appPath,
    name: 'Foo.exe',
    gameKey: 'iracing',
    warning: 'w'
  })
  unclosedProcesses.set(
    getUnclosedProcessKey('iracing', appPath, 'foo.exe'),
    unclosedEntry(appPath)
  )
  unclosedProcesses.set(getUnclosedProcessKey('acc', appPath, 'foo.exe'), {
    ...unclosedEntry(appPath),
    gameKey: 'acc'
  })

  dismissAppIcon('c:/apps/foo.exe', 'iracing')

  expect(processNameMismatchWarnings.size).toBe(0)
  // Only the matching game's unclosed entry is dismissed.
  expect([...unclosedProcesses.keys()]).toEqual([getUnclosedProcessKey('acc', appPath, 'foo.exe')])
})

// #716: switch-profile-apps registers its OWN launch controller before it
// kills the outgoing profile's apps, and passes that same controller as
// `except` to killProfileApps so its own kill step doesn't self-abort the
// switch it is in the middle of performing (the "self-abort trap" named in
// the issue's fix sketch). A real user's Close Apps click never passes
// `except`, so it must still abort everything as before.
test('abortActiveLaunches skips the except controller but still aborts every other one', () => {
  const ownSwitchController = registerActiveLaunch('iracing')
  const unrelatedController = registerActiveLaunch('acc')

  try {
    abortActiveLaunches('iracing', { except: ownSwitchController })
    expect(ownSwitchController.signal.aborted).toBe(false)
    expect(unrelatedController.signal.aborted).toBe(false)

    // The gameKey-less "close everything" form (tray/global kill) must also
    // respect `except` — a real Close Apps click for a DIFFERENT gameKey
    // (or the global kill) must still leave the excluded controller alone.
    abortActiveLaunches(undefined, { except: ownSwitchController })
    expect(ownSwitchController.signal.aborted).toBe(false)
    expect(unrelatedController.signal.aborted).toBe(true)

    // A real Close Apps click (no `except`) must still abort it.
    abortActiveLaunches('iracing')
    expect(ownSwitchController.signal.aborted).toBe(true)
  } finally {
    unregisterActiveLaunch('iracing', ownSwitchController)
    unregisterActiveLaunch('acc', unrelatedController)
  }
})

// #204. Auto-close's exit evidence lives here rather than in autoClose.ts for
// exactly this: registering a launch has to drop it SYNCHRONOUSLY. Clearing it
// from a process scan instead is not sound, because publishRunningApps('launch')
// is fire-and-forget and a companion-only or failed sequence can finish before
// that publish's tasklist read resolves, so no scan ever sees an active launch.
test('registering a launch clears that game exit evidence (#204)', () => {
  // The value is the monotonic timestamp of the first read in the streak; only
  // its presence matters here.
  gamesSeenRunning.set('iracing', 0)
  gamesSeenRunning.set('ac', 0)

  const controller = registerActiveLaunch('iracing')

  expect(gamesSeenRunning.has('iracing')).toBe(false)
  // Only the launching game: another game's session is none of its business.
  expect(gamesSeenRunning.has('ac')).toBe(true)

  unregisterActiveLaunch('iracing', controller)
  gamesSeenRunning.clear()
})

test('isLaunchActiveForGame tracks the registration it is named for (#204)', () => {
  expect(isLaunchActiveForGame('iracing')).toBe(false)

  const controller = registerActiveLaunch('iracing')
  expect(isLaunchActiveForGame('iracing')).toBe(true)
  // Per game key, so one profile launching says nothing about another.
  expect(isLaunchActiveForGame('ac')).toBe(false)

  unregisterActiveLaunch('iracing', controller)
  expect(isLaunchActiveForGame('iracing')).toBe(false)
})

// The counter exists because "is a launch active" is a point-in-time sample: a
// companion-only sequence can register AND unregister inside one tasklist read,
// so an auto-close that samples before and after its read misses it entirely
// and then closes what that launch just started (CodeRabbit on #826).
test('registering a launch bumps that game launch generation (#204)', () => {
  const before = getLaunchGeneration('iracing')

  const first = registerActiveLaunch('iracing')
  expect(getLaunchGeneration('iracing')).toBe(before + 1)
  // Unregistering must NOT roll it back, or a sequence that finished inside a
  // pending close's read would become invisible again.
  unregisterActiveLaunch('iracing', first)
  expect(getLaunchGeneration('iracing')).toBe(before + 1)

  const second = registerActiveLaunch('iracing')
  expect(getLaunchGeneration('iracing')).toBe(before + 2)
  // Per game key, like every other launch registry here.
  expect(getLaunchGeneration('ac')).toBe(0)

  unregisterActiveLaunch('iracing', second)
})
