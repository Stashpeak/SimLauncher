/**
 * Regression tests for #880: switching profiles reported unsaved changes
 * nobody made.
 *
 * `useDirtyTracking` captures its baseline once (`if (!loading && baseline ===
 * null)`) and only `resetDirty` clears it. `<ProfileEditor>` was rendered
 * without a `key`, so React reused the instance across a profile change and the
 * previous profile's baseline survived into the new one. The editor then
 * reported changes nobody made, and Save wrote that stale baseline over the
 * profile on screen.
 *
 * The fix is structural rather than another reset call: one editor instance,
 * one profile.
 *
 * ⚠️ These tests document the MECHANISM, they do not guard the fix. They drive
 * `useDirtyTracking` through a probe and supply their own keys, so they pass
 * whether or not `GameRow` actually passes a `key` to `<ProfileEditor>`. Deleting
 * that key would reintroduce #880 with this file still green. A guard has to
 * mount `GameRow` instead, which is tracked as #923 along with the two dead ends
 * a first attempt already hit. What these pin instead is why the key is
 * load-bearing, so a future refactor that removes it has something to read:
 *   1. reusing an instance across a profile change carries the stale baseline
 *   2. a changed key remounts and the new profile arrives clean
 *   3. an edit to the SAME profile still reports dirty, so the fix does not
 *      silence the warning it is supposed to preserve
 */

import { describe, expect, test } from 'vitest'
import { act, useEffect, useRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { useDirtyTracking } from '../../src/renderer/src/hooks/useDirtyTracking'

interface ProfileState {
  name: string
  exePath: string
}

const DEFAULT_PROFILE: ProfileState = { name: 'Default', exePath: 'C:/iracing.exe' }
const OTHER_PROFILE: ProfileState = { name: 'Wet setup', exePath: 'C:/iracing.exe' }

/** Stands in for `<ProfileEditor>`: takes a profile, tracks it, reports dirty. */
function EditorProbe({
  profile,
  onDirtyChange
}: {
  profile: ProfileState
  onDirtyChange: (isDirty: boolean) => void
}) {
  const { isDirty } = useDirtyTracking(profile, false)
  const report = useRef(onDirtyChange)
  report.current = onDirtyChange

  useEffect(() => {
    report.current(isDirty)
  }, [isDirty])

  return null
}

async function mount(): Promise<{
  render: (profile: ProfileState, key: string) => Promise<void>
  isDirty: () => boolean
  unmount: () => void
}> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let dirty = false
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
  })

  return {
    render: async (profile, key) => {
      await act(async () => {
        root?.render(
          <EditorProbe key={key} profile={profile} onDirtyChange={(next) => (dirty = next)} />
        )
      })
    },
    isDirty: () => dirty,
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    }
  }
}

describe('profile editor identity across a profile switch (#880)', () => {
  test('a reused instance carries the previous profile baseline, which is the bug', async () => {
    const harness = await mount()
    try {
      await harness.render(DEFAULT_PROFILE, 'iracing:same-key')
      expect(harness.isDirty()).toBe(false)

      // Same key, different profile: React keeps the instance and the baseline
      // captured for DEFAULT_PROFILE is compared against OTHER_PROFILE.
      await harness.render(OTHER_PROFILE, 'iracing:same-key')

      expect(harness.isDirty()).toBe(true)
    } finally {
      harness.unmount()
    }
  })

  test('changing the key remounts, so the switched-to profile arrives clean', async () => {
    const harness = await mount()
    try {
      await harness.render(DEFAULT_PROFILE, 'iracing:profile-a')
      expect(harness.isDirty()).toBe(false)

      // What GameRow now does: the key carries the profile id, so a switch is a
      // different element and the baseline is captured fresh for the new profile.
      await harness.render(OTHER_PROFILE, 'iracing:profile-b')

      expect(harness.isDirty()).toBe(false)
    } finally {
      harness.unmount()
    }
  })

  test('a real edit still reports dirty once the profile is mounted', async () => {
    const harness = await mount()
    try {
      await harness.render(DEFAULT_PROFILE, 'iracing:profile-a')
      expect(harness.isDirty()).toBe(false)

      // Same profile, edited in place: the key is unchanged because the profile
      // is unchanged, and the warning must still fire.
      await harness.render({ ...DEFAULT_PROFILE, name: 'Default edited' }, 'iracing:profile-a')

      expect(harness.isDirty()).toBe(true)
    } finally {
      harness.unmount()
    }
  })
})
