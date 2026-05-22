import { describe, expect, test } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { useDirtyTracking } from '../../src/renderer/src/hooks/useDirtyTracking'

interface ProbeState {
  isDirty: boolean
  setProfileName: (name: string) => void
}

function ProfileLike({
  onCapture,
  initialName
}: {
  onCapture: (state: ProbeState) => void
  initialName: string
}) {
  const [profileName, setProfileName] = useState(initialName)
  const [profileUtilities] = useState<Array<{ id: string; enabled: boolean }>>([])
  const currentState = { profileName, profileUtilities }
  const { isDirty } = useDirtyTracking(currentState, false)
  onCapture({ isDirty, setProfileName })
  return null
}

async function mountProbe(initialName: string) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  let captured: ProbeState | null = null
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(<ProfileLike onCapture={(state) => (captured = state)} initialName={initialName} />)
  })

  return {
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    },
    getState: () => {
      if (!captured) {
        throw new Error('Probe did not capture state')
      }
      return captured
    }
  }
}

describe('profile name dirty tracking (#400)', () => {
  test('typing a new profile name marks the profile dirty', async () => {
    const harness = await mountProbe('Default')
    try {
      expect(harness.getState().isDirty).toBe(false)

      await act(async () => {
        harness.getState().setProfileName('Default ')
      })

      expect(harness.getState().isDirty).toBe(true)

      await act(async () => {
        harness.getState().setProfileName('Endurance Setup')
      })

      expect(harness.getState().isDirty).toBe(true)
    } finally {
      harness.unmount()
    }
  })

  test('reverting the profile name back clears the dirty flag', async () => {
    const harness = await mountProbe('Default')
    try {
      await act(async () => {
        harness.getState().setProfileName('Sprint')
      })

      expect(harness.getState().isDirty).toBe(true)

      await act(async () => {
        harness.getState().setProfileName('Default')
      })

      expect(harness.getState().isDirty).toBe(false)
    } finally {
      harness.unmount()
    }
  })
})
