/**
 * Game path tips in Settings → Games (#989).
 *
 * An Assetto Corsa player pointed SimLauncher at acs.exe, which works but skips
 * Content Manager, and nothing in the app said so (#987). Two pieces fix that:
 * an "i" beside the games where the obvious exe is not the best one, and a
 * line under the AC path field while it points at acs.exe, because someone who
 * picked acs.exe does not know there is anything to hover.
 *
 * Pinned here: the tip is a real, labelled button carrying its text for screen
 * readers; the hint follows the file name whatever the case, separator or
 * Explorer's quotes; it is tied to the field it describes; and games without a
 * tip look exactly as before.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { GamesSection } from '../../src/renderer/src/components/settings/GamesSection'
import { GamesContext } from '../../src/renderer/src/components/settings/GamesContext'

const AC_TIP = 'If you launch AC through Content Manager, set the path to Content Manager.exe.'
const AC_HINT = 'Using Content Manager? Set the path to its exe instead.'
const IRACING_TIP = 'Set the path to iRacingUI.exe, the iRacing app you start sessions from.'

let root: Root | null = null
let container: HTMLElement | null = null

async function renderSection(gamePaths: Record<string, string> = {}): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container as HTMLElement)
    root.render(
      <GamesContext.Provider
        value={{ gamePaths, gameIcons: {}, onBrowse: vi.fn(), onGamePathChange: vi.fn() }}
      >
        <GamesSection />
      </GamesContext.Provider>
    )
  })
  return container as HTMLElement
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
})

const tipButton = (section: HTMLElement, game: string): HTMLButtonElement | null =>
  section.querySelector(`button[aria-label="Tip for the ${game} path"]`)
const pathInput = (section: HTMLElement, game: string): HTMLInputElement | null =>
  section.querySelector(`input[aria-label="${game} executable path"]`)

describe('Settings → Games path tips (#989)', () => {
  test('AC and iRacing carry a tip button with the agreed wording', async () => {
    const section = await renderSection()

    expect(tipButton(section, 'Assetto Corsa')?.getAttribute('aria-description')).toBe(AC_TIP)
    expect(tipButton(section, 'iRacing')?.getAttribute('aria-description')).toBe(IRACING_TIP)
    // A button, so Tab reaches it and the tooltip opens on focus.
    expect(tipButton(section, 'Assetto Corsa')?.getAttribute('type')).toBe('button')
  })

  test('a game without a tip has no button', async () => {
    const section = await renderSection()

    expect(tipButton(section, 'Assetto Corsa Competizione')).toBeNull()
    expect(section.querySelectorAll('button[aria-label^="Tip for the"]')).toHaveLength(2)
  })

  test.each([
    ['C:\\Steam\\steamapps\\common\\assettocorsa\\acs.exe'],
    ['c:/steam/steamapps/common/assettocorsa/ACS.EXE'],
    ['"C:\\Steam\\steamapps\\common\\assettocorsa\\acs.exe"']
  ])('an AC path to acs.exe shows the hint, tied to the field: %s', async (path) => {
    const section = await renderSection({ ac: path })

    expect(section.textContent).toContain(AC_HINT)
    const input = pathInput(section, 'Assetto Corsa')
    const describedBy = input?.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(section.querySelector(`[id="${describedBy}"]`)?.textContent).toBe(AC_HINT)
  })

  test.each([
    ['C:\\Apps\\Content Manager\\Content Manager.exe'],
    ['C:\\Steam\\steamapps\\common\\assettocorsa\\AssettoCorsa.exe'],
    ['C:\\Games\\notacs.exe'],
    ['']
  ])('any other AC path shows no hint: %s', async (path) => {
    const section = await renderSection({ ac: path })

    expect(section.textContent).not.toContain(AC_HINT)
    expect(pathInput(section, 'Assetto Corsa')?.hasAttribute('aria-describedby')).toBe(false)
  })

  // The hint belongs to AC's registry entry, not to the file name everywhere.
  test('acs.exe on another game shows no hint', async () => {
    const section = await renderSection({ acc: 'C:\\Games\\acs.exe' })

    expect(section.textContent).not.toContain(AC_HINT)
  })
})
