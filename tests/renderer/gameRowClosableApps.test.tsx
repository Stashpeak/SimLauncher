/**
 * #673: after a SimLauncher restart (or a process-tracking toggle cycle, or a
 * companion that autostarts with Windows) a profile's companions can be running
 * while nothing is in the strip. The row used to offer NOTHING in that state,
 * even though `killLaunchedApps` would have closed them: the only way back was
 * to launch the game.
 *
 * What is pinned here is the shape of the fix, because the obvious version of
 * it is a regression. `canKill` REPLACES the primary action rather than adding
 * to it, so widening `canKill` would hand anyone with an autostarted SimHub a
 * red Close Apps primary and no way to launch the game from that row, removing
 * the one in-app recovery the bug leaves intact. The rule, decided on the issue
 * 2026-08-04: Close Apps displaces Launch only when there is visible session
 * state; ambient closable state gets a SECONDARY control.
 */

import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

vi.mock('../../src/renderer/src/components/Notify', () => ({
  useNotify: () => ({ notify: vi.fn(), announce: vi.fn() }),
  NotifyProvider: ({ children }: { children: React.ReactNode }) => children
}))

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

import { GameRowActions } from '../../src/renderer/src/components/game-list/GameRowActions'

const activeProfileSet = {
  activeProfileId: 'default',
  profiles: [{ id: 'default', name: 'Default' }]
}

const PROFILE_MENU_PROPS = {
  profileSet: activeProfileSet,
  activeProfile: activeProfileSet.profiles[0],
  profileMenuOpen: false,
  openProfileMenu: vi.fn(),
  closeProfileMenu: vi.fn(),
  profileMenuRef: { current: null },
  menuRef: { current: null },
  triggerRef: { current: null },
  handleProfileMenuTriggerKeyDown: vi.fn(),
  handleProfileMenuKeyDown: vi.fn(),
  newProfileFormOpen: false,
  newProfileName: '',
  setNewProfileName: vi.fn(),
  newProfileInputRef: { current: null },
  gameName: 'Assetto Corsa',
  onProfileSelect: vi.fn(),
  onNewProfileSubmit: vi.fn()
} as unknown as React.ComponentProps<typeof GameRowActions>['profileMenuProps']

let container: HTMLDivElement
let root: Root | null = null

async function renderActions(state: {
  canKill: boolean
  canCloseLeftovers: boolean
  canRelaunch?: boolean
  onKill?: () => void
  onPrimary?: () => void
}): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <GameRowActions
        isActive={false}
        isLaunching={false}
        isLaunchBlocked={false}
        canKill={state.canKill}
        canCloseLeftovers={state.canCloseLeftovers}
        canRelaunch={state.canRelaunch ?? false}
        onPrimary={state.onPrimary ?? vi.fn()}
        onKill={state.onKill ?? vi.fn()}
        onRelaunchMissing={vi.fn()}
        onToggleEditor={vi.fn()}
        gameName="Assetto Corsa"
        activeProfileName="Default"
        editorId="editor-ac"
        profileMenuProps={PROFILE_MENU_PROPS}
      />
    )
  })
}

function buttonByLabel(label: string): HTMLButtonElement | null {
  return container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)
}

const SECONDARY_LABEL = 'Close companion apps for Assetto Corsa that are still running'
const LAUNCH_LABEL = 'Launch Assetto Corsa: Default profile'

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await act(async () => {
    root?.unmount()
  })
  root = null
  container.remove()
})

// The whole point of the fix: the row now offers something, and it is NOT at
// the cost of the primary button.
test('ambient closable state adds a secondary close and leaves Launch primary (#673)', async () => {
  await renderActions({ canKill: false, canCloseLeftovers: true })

  expect(buttonByLabel(SECONDARY_LABEL)).not.toBeNull()
  // The regression this shape exists to avoid. If this ever fails, the row has
  // lost its only in-app recovery path for a profile whose game is closed.
  expect(buttonByLabel(LAUNCH_LABEL)).not.toBeNull()
  expect(buttonByLabel('Close companion apps for Assetto Corsa')).toBeNull()
})

// Nothing closable is the ordinary state of most rows most of the time, so the
// control has to be absent rather than merely disabled: an always-present close
// on every row with SimHub configured is exactly the ambient invitation the
// secondary placement is meant to avoid.
test('no closable apps means no secondary control at all (#673)', async () => {
  await renderActions({ canKill: false, canCloseLeftovers: false })

  expect(buttonByLabel(SECONDARY_LABEL)).toBeNull()
  expect(buttonByLabel(LAUNCH_LABEL)).not.toBeNull()
})

// Visible session state is the case where displacement IS correct, and the two
// controls must not both appear: one close per row, in one place.
test('a running profile keeps the primary Close Apps and adds nothing (#673)', async () => {
  await renderActions({ canKill: true, canCloseLeftovers: false })

  expect(buttonByLabel('Close companion apps for Assetto Corsa')).not.toBeNull()
  expect(buttonByLabel(SECONDARY_LABEL)).toBeNull()
  expect(buttonByLabel(LAUNCH_LABEL)).toBeNull()
})

// Codex on #853 disproved the assumption this file was built on: relaunch and
// the secondary close are NOT mutually exclusive. `canRelaunch` reads the
// aggregate running state, which the game's own exe satisfies alone, while the
// strip behind `canKill` excludes that exe — so a game running alongside an
// ambient companion (never ours to launch, so never in the strip) reaches both.
// Hiding one behind the other there would put the close out of reach in exactly
// the state #673 exists for, so both render.
test('an ambient companion stays reachable while relaunch also applies (#853)', async () => {
  await renderActions({ canKill: false, canCloseLeftovers: true, canRelaunch: true })

  expect(buttonByLabel('Relaunch missing apps for Assetto Corsa')).not.toBeNull()
  expect(buttonByLabel(SECONDARY_LABEL)).not.toBeNull()
  // Still exactly one close per row: the secondary must not have become a
  // second primary on the way.
  expect(buttonByLabel('Close companion apps for Assetto Corsa')).toBeNull()
})

// The overlap is the only state that widens the row. Every other row keeps one
// reserved 36px slot, so the primary button stays on the same vertical line
// down the list whether or not a row has anything in it.
test('only the overlap adds a second icon slot (#853)', async () => {
  // Direct children of the actions row only: the buttons carry the same sizing
  // classes, and counting those would pass no matter how the slots are nested.
  const slots = () => container.querySelectorAll('.gap-3.no-drag > div.h-9.w-9').length

  await renderActions({ canKill: false, canCloseLeftovers: true })
  expect(slots()).toBe(1)

  await act(async () => {
    root?.unmount()
  })
  container.remove()

  await renderActions({ canKill: false, canCloseLeftovers: true, canRelaunch: true })
  expect(slots()).toBe(2)
})

// It has to actually close: the control reaches the same handler the primary
// Close Apps does, not a new path that would need its own confirmation and
// cancellation semantics.
test('the secondary control fires the same kill handler as the primary (#673)', async () => {
  const onKill = vi.fn()
  const onPrimary = vi.fn()
  await renderActions({ canKill: false, canCloseLeftovers: true, onKill, onPrimary })

  await act(async () => {
    buttonByLabel(SECONDARY_LABEL)?.click()
  })

  expect(onKill).toHaveBeenCalledTimes(1)
  expect(onPrimary).not.toHaveBeenCalled()
})
