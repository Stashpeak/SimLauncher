/**
 * Regression tests for #438 — value-equality dirty tracking for profileUtilities.
 *
 * Toggling a utility off and back on changes its position in the raw
 * profileUtilities array (handleToggleUtility pushes disabled entries to the
 * end and re-inserts enabled entries after the last currently-enabled entry).
 * Without the normalisation added in #438, useDirtyTracking would compare the
 * reordered array against the original-order snapshot and leave isDirty=true
 * even though the user has reverted to the saved enabled/disabled state.
 *
 * These tests verify the normalised representation used in currentProfileState:
 *   • enabled utilities keep their launch order (order-sensitive)
 *   • disabled utilities are sorted by id (order-insensitive)
 */

import { describe, expect, test } from 'vitest'
import { act, useMemo, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useDirtyTracking } from '../../src/renderer/src/hooks/useDirtyTracking'

interface UtilityEntry {
  id: string
  enabled: boolean
}

/** Mirrors the normalisation applied in useProfileEditor.currentProfileState (#438). */
function normaliseUtilities(utilities: UtilityEntry[]): Array<{ id: string; enabled: boolean }> {
  return [
    ...utilities.filter((u) => u.enabled).map((u) => ({ id: u.id, enabled: true })),
    ...utilities
      .filter((u) => !u.enabled)
      .sort((a, b) => a.id.localeCompare(b.id))
      .map((u) => ({ id: u.id, enabled: false }))
  ]
}

interface ProbeState {
  isDirty: boolean
  setUtilities: (utils: UtilityEntry[]) => void
}

function UtilityProbe({
  onCapture,
  initialUtilities
}: {
  onCapture: (state: ProbeState) => void
  initialUtilities: UtilityEntry[]
}) {
  const [utilities, setUtilities] = useState<UtilityEntry[]>(initialUtilities)

  const currentState = useMemo(
    () => ({
      profileName: 'Default',
      profileUtilities: normaliseUtilities(utilities)
    }),
    [utilities]
  )

  const { isDirty } = useDirtyTracking(currentState, false)
  onCapture({ isDirty, setUtilities })
  return null
}

async function mountProbe(initialUtilities: UtilityEntry[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let captured: ProbeState | null = null
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(
      <UtilityProbe onCapture={(state) => (captured = state)} initialUtilities={initialUtilities} />
    )
  })

  return {
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    },
    getState: () => {
      if (!captured) throw new Error('Probe did not capture state')
      return captured
    }
  }
}

describe('utility toggle dirty tracking (#438)', () => {
  test('toggling a disabled utility on marks dirty, toggling back off clears it', async () => {
    // Initial: two disabled utilities
    const initial: UtilityEntry[] = [
      { id: 'obs', enabled: false },
      { id: 'discord', enabled: false }
    ]
    const harness = await mountProbe(initial)
    try {
      expect(harness.getState().isDirty).toBe(false)

      // Toggle obs ON — it goes after the last enabled entry (none yet),
      // so array becomes [{obs,true},{discord,false}]
      await act(async () => {
        harness.getState().setUtilities([
          { id: 'obs', enabled: true },
          { id: 'discord', enabled: false }
        ])
      })
      expect(harness.getState().isDirty).toBe(true)

      // Toggle obs back OFF — handleToggleUtility pushes it to the end:
      // raw array = [{discord,false},{obs,false}]  ← ORDER DIFFERS from initial
      // Normalised form: disabled sorted by id → [{discord,false},{obs,false}]
      // Snapshot normalised form: [{discord,false},{obs,false}]
      // They match → isDirty should clear.
      await act(async () => {
        harness.getState().setUtilities([
          { id: 'discord', enabled: false },
          { id: 'obs', enabled: false }
        ])
      })
      expect(harness.getState().isDirty).toBe(false)
    } finally {
      harness.unmount()
    }
  })

  test('re-ordering a disabled utility that was toggled off does not matter for dirty', async () => {
    // Three utilities: one enabled, two disabled
    const initial: UtilityEntry[] = [
      { id: 'obs', enabled: true },
      { id: 'discord', enabled: false },
      { id: 'teamspeak', enabled: false }
    ]
    const harness = await mountProbe(initial)
    try {
      expect(harness.getState().isDirty).toBe(false)

      // Rearrange the disabled utilities (different order among disabled entries only)
      await act(async () => {
        harness.getState().setUtilities([
          { id: 'obs', enabled: true },
          { id: 'teamspeak', enabled: false },
          { id: 'discord', enabled: false }
        ])
      })
      // Disabled order changed but both are still disabled — value-equality says not dirty
      expect(harness.getState().isDirty).toBe(false)
    } finally {
      harness.unmount()
    }
  })

  test('reordering enabled utilities (launch order) keeps dirty=true', async () => {
    // Two enabled utilities — order is meaningful (launch order)
    const initial: UtilityEntry[] = [
      { id: 'obs', enabled: true },
      { id: 'discord', enabled: true }
    ]
    const harness = await mountProbe(initial)
    try {
      expect(harness.getState().isDirty).toBe(false)

      // Swap the launch order of the two enabled utilities
      await act(async () => {
        harness.getState().setUtilities([
          { id: 'discord', enabled: true },
          { id: 'obs', enabled: true }
        ])
      })
      // Launch order changed — dirty should stay true
      expect(harness.getState().isDirty).toBe(true)
    } finally {
      harness.unmount()
    }
  })

  test('toggling enabled utility off and back on (changes launch order) keeps dirty=true', async () => {
    // obs before discord in launch order
    const initial: UtilityEntry[] = [
      { id: 'obs', enabled: true },
      { id: 'discord', enabled: true },
      { id: 'teamspeak', enabled: false }
    ]
    const harness = await mountProbe(initial)
    try {
      expect(harness.getState().isDirty).toBe(false)

      // Toggle obs OFF: goes to end → [discord, teamspeak, obs(OFF)]
      await act(async () => {
        harness.getState().setUtilities([
          { id: 'discord', enabled: true },
          { id: 'teamspeak', enabled: false },
          { id: 'obs', enabled: false }
        ])
      })
      expect(harness.getState().isDirty).toBe(true)

      // Toggle obs back ON: goes after last enabled (discord) → [discord, obs, teamspeak]
      // Launch order is now discord→obs instead of original obs→discord
      await act(async () => {
        harness.getState().setUtilities([
          { id: 'discord', enabled: true },
          { id: 'obs', enabled: true },
          { id: 'teamspeak', enabled: false }
        ])
      })
      // Launch order has changed (obs moved after discord) — still dirty
      expect(harness.getState().isDirty).toBe(true)
    } finally {
      harness.unmount()
    }
  })
})
