/**
 * The per-profile "Allow close apps controls" / "Allow relaunch controls" flags
 * default ON: managing companion apps is the core use case, so the row's Close
 * Apps (X) and Relaunch buttons appear unless a profile explicitly opts out with
 * `false`. Profiles saved before these toggles existed (field absent) get them
 * too. Only a deliberate `false` hides the controls (#590).
 */

import { describe, expect, test } from 'vitest'

import { getProfileState } from '../../src/renderer/src/lib/profileControls'
import type { GameProfileSet } from '../../src/renderer/src/lib/config'

const makeSet = (flags: {
  killControlsEnabled?: boolean
  relaunchControlsEnabled?: boolean
}): GameProfileSet => ({
  activeProfileId: 'p1',
  profiles: [{ id: 'p1', name: 'Test', utilities: [], ...flags }]
})

describe('getProfileState — close/relaunch controls default ON (#590)', () => {
  test('enabled when the fields are absent (new / pre-toggle profiles)', () => {
    const state = getProfileState(makeSet({}))
    expect(state.killControlsEnabled).toBe(true)
    expect(state.relaunchControlsEnabled).toBe(true)
  })

  test('disabled only when explicitly false', () => {
    const state = getProfileState(
      makeSet({ killControlsEnabled: false, relaunchControlsEnabled: false })
    )
    expect(state.killControlsEnabled).toBe(false)
    expect(state.relaunchControlsEnabled).toBe(false)
  })

  test('enabled when explicitly true', () => {
    const state = getProfileState(
      makeSet({ killControlsEnabled: true, relaunchControlsEnabled: true })
    )
    expect(state.killControlsEnabled).toBe(true)
    expect(state.relaunchControlsEnabled).toBe(true)
  })

  test('each flag is independent', () => {
    const state = getProfileState(makeSet({ killControlsEnabled: false }))
    expect(state.killControlsEnabled).toBe(false)
    expect(state.relaunchControlsEnabled).toBe(true)
  })
})
