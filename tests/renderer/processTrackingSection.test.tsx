/**
 * The "Secondary executables to watch" inputs must take typed and pasted
 * input (#890). They shipped `readOnly`, so the only way to fill one was the
 * Browse dialog, which cannot express a process name from Task Manager (the
 * app's own phantom-exit warning tells the user to add exactly that) and
 * refuses a file that is not installed yet.
 *
 * The second test guards a trap that arrived with typing: the row was keyed
 * on its own value, so every keystroke changed the key, remounted the row and
 * dropped focus after one character.
 */

import { describe, expect, test, vi } from 'vitest'
import { act, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { ProcessTrackingSection } from '../../src/renderer/src/components/profile-editor/ProcessTrackingSection'

// React listens for the native `input` event and reads the value through the
// element's own descriptor, so a test has to set it the way a keystroke would:
// via the prototype setter, past React's value tracker, then dispatch.
function typeInto(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  if (!setter) throw new Error('HTMLInputElement value setter not found')
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

function Harness({
  initialPaths,
  onChangeSpy
}: {
  initialPaths: string[]
  onChangeSpy: (index: number, value: string) => void
}) {
  const [paths, setPaths] = useState(initialPaths)

  return (
    <ProcessTrackingSection
      killControlsEnabled
      relaunchControlsEnabled
      trackedProcessPaths={paths}
      onKillControlsEnabledChange={() => {}}
      onRelaunchControlsEnabledChange={() => {}}
      onAddTrackedProcess={() => setPaths((prev) => [...prev, ''])}
      onBrowseTrackedProcess={() => {}}
      onRemoveTrackedProcess={(index) =>
        setPaths((prev) => prev.filter((_, current) => current !== index))
      }
      onTrackedProcessPathChange={(index, value) => {
        onChangeSpy(index, value)
        setPaths((prev) => prev.map((current, i) => (i === index ? value : current)))
      }}
    />
  )
}

async function mount(initialPaths: string[]) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const onChangeSpy = vi.fn()
  let root: Root | null = null

  await act(async () => {
    root = createRoot(container)
    root.render(<Harness initialPaths={initialPaths} onChangeSpy={onChangeSpy} />)
  })

  const getInput = (index: number): HTMLInputElement => {
    const input = container.querySelector<HTMLInputElement>(
      `input[aria-label="Secondary executable ${index + 1}"]`
    )
    if (!input) throw new Error(`Secondary executable ${index + 1} input not rendered`)
    return input
  }

  return {
    onChangeSpy,
    getInput,
    unmount: () => {
      act(() => {
        root?.unmount()
      })
      container.remove()
    }
  }
}

describe('ProcessTrackingSection secondary executable input (#890)', () => {
  test('typing into the field reports the new value for that row', async () => {
    const harness = await mount(['C:/Tools/Telemetry.exe', ''])
    try {
      const second = harness.getInput(1)
      expect(second.readOnly).toBe(false)

      await act(async () => {
        typeInto(second, 'C:/Tools/Overlay.exe')
      })

      expect(harness.onChangeSpy).toHaveBeenCalledWith(1, 'C:/Tools/Overlay.exe')
      expect(harness.getInput(1).value).toBe('C:/Tools/Overlay.exe')
      // The other row is untouched: the change is addressed by index, not
      // broadcast.
      expect(harness.getInput(0).value).toBe('C:/Tools/Telemetry.exe')
    } finally {
      harness.unmount()
    }
  })

  test('the field survives a keystroke instead of being remounted', async () => {
    const harness = await mount([''])
    try {
      const input = harness.getInput(0)
      input.focus()
      expect(document.activeElement).toBe(input)

      await act(async () => {
        typeInto(input, 'C')
      })

      // Same element, still in the document, still focused. A row keyed on its
      // own value fails all three: the key changes with the value, React
      // replaces the row, and the user's second character goes nowhere.
      expect(input.isConnected).toBe(true)
      expect(harness.getInput(0)).toBe(input)
      expect(document.activeElement).toBe(input)
    } finally {
      harness.unmount()
    }
  })
})
