import type { ChildProcess } from 'child_process'
import { beforeEach, expect, test } from 'vitest'

import {
  abortActiveLaunches,
  consumeProcessNameMismatchWarningSuppression,
  dismissAppIcon,
  getUnclosedProcessKey,
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
