import { expect, test } from 'vitest'

import { formatKillFailures } from '../../src/renderer/src/lib/killFailures'

test('formatKillFailures returns generic copy when no failures are provided', () => {
  expect(formatKillFailures([])).toBe('Some companion apps could not be closed.')
})

test('formatKillFailures uses UAC-specific copy for a single access_denied failure', () => {
  const message = formatKillFailures([
    { appName: 'CrewChief.exe', appPath: 'C:/Apps/CrewChief.exe', reason: 'access_denied' }
  ])

  expect(message).toContain('CrewChief.exe is still running')
  expect(message).toContain('Windows denied SimLauncher permission')
  expect(message).toContain('run SimLauncher as administrator')
})

test('formatKillFailures uses generic copy for a single non-UAC failure', () => {
  expect(
    formatKillFailures([
      { appName: 'SimHub.exe', appPath: 'C:/Apps/SimHub.exe', reason: 'still_running' }
    ])
  ).toBe('SimHub.exe could not be closed and is still running.')
})

test('formatKillFailures lists all app names when multiple failures share access_denied reason', () => {
  const message = formatKillFailures([
    { appName: 'CrewChief.exe', appPath: 'C:/Apps/CrewChief.exe', reason: 'access_denied' },
    { appName: 'SimHub.exe', appPath: 'C:/Apps/SimHub.exe', reason: 'access_denied' }
  ])

  expect(message).toContain('2 apps')
  expect(message).toContain('CrewChief.exe, SimHub.exe')
  expect(message).toContain('Windows denied SimLauncher permission')
})

test('formatKillFailures uses generic multi-app copy when reasons are mixed', () => {
  const message = formatKillFailures([
    { appName: 'CrewChief.exe', appPath: 'C:/Apps/CrewChief.exe', reason: 'access_denied' },
    { appName: 'SimHub.exe', appPath: 'C:/Apps/SimHub.exe', reason: 'still_running' }
  ])

  expect(message).toBe(
    '2 apps could not be closed and are still running (CrewChief.exe, SimHub.exe).'
  )
})
