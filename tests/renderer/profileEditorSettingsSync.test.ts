import { describe, expect, test } from 'vitest'

import { syncProfileUtilitiesWithSettings } from '../../src/renderer/src/lib/profileEditorSettingsSync'

describe('syncProfileUtilitiesWithSettings', () => {
  test('adds a newly configured custom app without resetting existing profile utility state', () => {
    const currentUtilities = [
      { id: 'simhub', enabled: true },
      { id: 'customapp1', enabled: true }
    ]

    const result = syncProfileUtilitiesWithSettings(
      currentUtilities,
      2,
      {
        customapp1: 'C:/Apps/First.exe',
        customapp2: 'C:/Apps/Second.exe'
      },
      {}
    )

    expect(result.utilities.some((utility) => utility.key === 'customapp2')).toBe(true)
    expect(result.profileUtilities).toContainEqual({ id: 'simhub', enabled: true })
    expect(result.profileUtilities).toContainEqual({ id: 'customapp1', enabled: true })
    expect(result.profileUtilities).toContainEqual({ id: 'customapp2', enabled: false })
  })

  test('keeps renamed custom app slots in resolved utilities', () => {
    const result = syncProfileUtilitiesWithSettings(
      [{ id: 'customapp1', enabled: false }],
      1,
      {},
      { customapp1: 'Telemetry Overlay' }
    )

    expect(result.utilities.some((utility) => utility.key === 'customapp1')).toBe(true)
    expect(result.profileUtilities).toContainEqual({ id: 'customapp1', enabled: false })
  })
})
