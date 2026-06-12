/**
 * Startup localStorage→store migration. The one-shot guard is the critical
 * behavior: if the migrated flag is ever ignored, every boot re-imports the
 * stale localStorage copy and silently overwrites the user's current config.
 */

import { beforeEach, describe, expect, test, vi } from 'vitest'

import {
  migrateFromLocalStorage,
  runStartupMigrations
} from '../../src/renderer/src/lib/migrations'

const getMigrationFlagsMock = vi.fn()
const saveSettingsMock = vi.fn()
const saveProfilesMock = vi.fn()
const setMigrationFlagsMock = vi.fn()

vi.mock('../../src/renderer/src/lib/store', () => ({
  getMigrationFlags: (...args: unknown[]) => getMigrationFlagsMock(...args),
  saveSettings: (...args: unknown[]) => saveSettingsMock(...args),
  saveProfiles: (...args: unknown[]) => saveProfilesMock(...args),
  setMigrationFlags: (...args: unknown[]) => setMigrationFlagsMock(...args)
}))

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  getMigrationFlagsMock.mockResolvedValue({ migrated: false })
  saveSettingsMock.mockResolvedValue(undefined)
  saveProfilesMock.mockResolvedValue(undefined)
  setMigrationFlagsMock.mockResolvedValue(undefined)
})

describe('migrateFromLocalStorage', () => {
  test('the migrated flag makes the migration a strict no-op (one-shot guard)', async () => {
    getMigrationFlagsMock.mockResolvedValue({ migrated: true })
    localStorage.setItem('simLauncherAppPaths', JSON.stringify({ simhub: 'C:/Old/SimHub.exe' }))

    await migrateFromLocalStorage()

    expect(saveSettingsMock).not.toHaveBeenCalled()
    expect(saveProfilesMock).not.toHaveBeenCalled()
    expect(setMigrationFlagsMock).not.toHaveBeenCalled()
  })

  test('migrates legacy paths, names, and profiles into named profile sets', async () => {
    localStorage.setItem(
      'simLauncherAppPaths',
      JSON.stringify({ simhub: 'C:/Tools/SimHub.exe', customapp2: 'C:/Tools/Overlay.exe' })
    )
    localStorage.setItem(
      'simLauncherGamePaths',
      JSON.stringify({ iracing: 'C:/Games/iRacingUI.exe' })
    )
    localStorage.setItem('simLauncherAppName_customapp2', 'Overlay')
    localStorage.setItem(
      'profile_iracing',
      JSON.stringify({ simhub: true, launchAutomatically: false })
    )

    await migrateFromLocalStorage()

    expect(saveSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        appPaths: { simhub: 'C:/Tools/SimHub.exe', customapp2: 'C:/Tools/Overlay.exe' },
        gamePaths: { iracing: 'C:/Games/iRacingUI.exe' },
        appNames: { customapp2: 'Overlay' },
        // Inferred from the highest legacy customapp slot in use.
        customSlots: 2
      })
    )

    const migratedProfiles = saveProfilesMock.mock.calls[0][0] as {
      iracing: {
        activeProfileId: string
        profiles: Array<Record<string, unknown>>
      }
    }
    expect(migratedProfiles.iracing.activeProfileId).toBe('default')
    const [defaultProfile] = migratedProfiles.iracing.profiles
    expect(defaultProfile.id).toBe('default')
    expect(defaultProfile.launchAutomatically).toBe(false)
    // Legacy boolean flags become the ordered utilities array...
    expect(defaultProfile.utilities).toContainEqual({ id: 'simhub', enabled: true })
    // ...and must not survive as raw boolean keys alongside it.
    expect(defaultProfile).not.toHaveProperty('simhub')

    expect(setMigrationFlagsMock).toHaveBeenCalledWith({
      profileUtilityOrderMigrated: true,
      migrated: true
    })
  })

  test('an empty localStorage still sets the migrated flag so the scan never reruns', async () => {
    await migrateFromLocalStorage()

    expect(saveSettingsMock).not.toHaveBeenCalled()
    expect(saveProfilesMock).not.toHaveBeenCalled()
    expect(setMigrationFlagsMock).toHaveBeenCalledWith({
      profileUtilityOrderMigrated: true,
      migrated: true
    })
  })
})

describe('runStartupMigrations', () => {
  test('swallows migration failures so a corrupt legacy value cannot block boot', async () => {
    localStorage.setItem('simLauncherAppPaths', '{not json')

    await expect(runStartupMigrations()).resolves.toBeUndefined()
    expect(saveSettingsMock).not.toHaveBeenCalled()
  })
})
