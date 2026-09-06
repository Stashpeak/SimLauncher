/**
 * The profile menu used to render inside the row (#884): absolute below the
 * trigger, cut off by the scroller on the bottom rows, blurred against nothing
 * because the row's glass surface is a backdrop root, and lined up with the
 * trigger button rather than with the pill the user sees as one control. It now
 * renders through a FloatingPortal, positioned by floating-ui with the PILL as
 * the reference. jsdom has no layout, so these pin what it can see: the portal,
 * which element is the reference, the placement config (`flip` is the upward
 * opening on the bottom row), and the outside-press rule in useProfileMenu that
 * the portal made necessary.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act, useEffect } from 'react'
import { createRoot, type Root } from 'react-dom/client'

// Record what each useFloating call is given and which element ends up as its
// reference. Everything else is the real library, so the portal is real too.
interface FloatingCall {
  options: Record<string, unknown>
  reference: Element | null
}
const floatingCalls: FloatingCall[] = []

vi.mock('@floating-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floating-ui/react')>()
  return {
    ...actual,
    useFloating: (options?: Parameters<typeof actual.useFloating>[0]) => {
      const call: FloatingCall = {
        options: (options ?? {}) as Record<string, unknown>,
        reference: null
      }
      floatingCalls.push(call)
      const result = actual.useFloating(options)
      return {
        ...result,
        refs: {
          ...result.refs,
          setReference: (node: Element | null) => {
            call.reference = node
            result.refs.setReference(node)
          }
        }
      }
    }
  }
})

import { autoUpdate } from '@floating-ui/react'
import {
  GameRowProfileMenu,
  type GameRowProfileMenuProps
} from '../../src/renderer/src/components/game-list/GameRowProfileMenu'
import { useProfileMenu } from '../../src/renderer/src/hooks/useProfileMenu'
import type { GameProfileSet } from '../../src/renderer/src/lib/config'

const PROFILE_SET: GameProfileSet = {
  activeProfileId: 'default',
  profiles: [
    { id: 'default', name: 'Default', utilities: [] },
    { id: 'race', name: 'Race', utilities: [] }
  ]
}

let root: Root | null = null
let container: HTMLElement | null = null

function staticProps(overrides: Partial<GameRowProfileMenuProps> = {}): GameRowProfileMenuProps {
  return {
    profileSet: PROFILE_SET,
    activeProfile: PROFILE_SET.profiles[0],
    profileMenuOpen: true,
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
    gameName: 'iRacing',
    onProfileSelect: vi.fn(),
    onNewProfileSubmit: vi.fn(),
    ...overrides
  }
}

// Stands in for the rest of the pill that GameRowActions passes as children.
const primaryButton = (
  <button type="button" aria-label="Launch iRacing">
    Play
  </button>
)

async function render(node: React.ReactNode): Promise<HTMLElement> {
  container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container as HTMLElement)
    root.render(node)
  })
  return container
}

// The menu's own useFloating calls, told apart from the trigger tooltip's by
// their placement. One record per render; a render that floating-ui's own
// position update schedules may not have committed yet when a test looks, so
// the reference is read as the set of elements any committed render attached.
function menuFloatingCalls(): FloatingCall[] {
  return floatingCalls.filter((call) => call.options.placement === 'bottom-end')
}

function menuReferences(): Element[] {
  const seen = new Set<Element>()
  for (const call of menuFloatingCalls()) {
    if (call.reference) seen.add(call.reference)
  }
  return Array.from(seen)
}

/** Uses the real hook, so the outside-press rule under test is the shipped one. */
function Harness(): React.ReactNode {
  const menu = useProfileMenu()
  useEffect(() => {
    menu.openProfileMenu()
    // Open once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <GameRowProfileMenu {...staticProps()} {...menu}>
      {primaryButton}
    </GameRowProfileMenu>
  )
}

function pressOn(target: EventTarget): void {
  target.dispatchEvent(new Event('pointerdown', { bubbles: true }))
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
  floatingCalls.length = 0
})

describe('GameRowProfileMenu positioning (#884)', () => {
  test('the open menu is portalled out of the row, the pill stays in it', async () => {
    const row = await render(
      <GameRowProfileMenu {...staticProps()}>{primaryButton}</GameRowProfileMenu>
    )

    const menu = document.body.querySelector('[role="menu"]')
    expect(menu).not.toBeNull()
    // Outside the row's subtree: no scroller to clip it, and no `.glass-surface`
    // backdrop root above it to starve the blur.
    expect(row.contains(menu)).toBe(false)

    const pill = row.querySelector('.glass-surface')
    expect(pill).not.toBeNull()
    expect(pill!.querySelector('button[aria-haspopup="menu"]')).not.toBeNull()
    expect(pill!.querySelector('button[aria-label="Launch iRacing"]')).not.toBeNull()
  })

  test('the floating reference is the whole pill, not the trigger button', async () => {
    const row = await render(
      <GameRowProfileMenu {...staticProps()}>{primaryButton}</GameRowProfileMenu>
    )

    const pill = row.querySelector('.glass-surface')
    const trigger = row.querySelector('button[aria-haspopup="menu"]')
    expect(pill).not.toBeNull()
    expect(trigger).not.toBeNull()
    // Every render attached the pill and nothing else, never the trigger.
    expect(menuReferences()).toEqual([pill])
  })

  test('right-aligned below the pill, flipping above it when there is no room, tracking layout changes', async () => {
    await render(<GameRowProfileMenu {...staticProps()}>{primaryButton}</GameRowProfileMenu>)

    const calls = menuFloatingCalls()
    expect(calls.length).toBeGreaterThan(0)
    const options = calls[0].options
    expect(options.placement).toBe('bottom-end')
    const middleware = (options.middleware as Array<{ name: string }>).map((entry) => entry.name)
    expect(middleware).toEqual(['offset', 'flip', 'shift'])
    expect(options.whileElementsMounted).toBe(autoUpdate)
  })

  test('inside #root, below the dialog layer, so a modal covers and inerts it', async () => {
    // The app mounts into #root and useFocusTrap marks that element inert
    // while any dialog is open. A menu portalled to body at z-9999 escaped
    // both (Codex P1 x2 on #940: still clickable above a z-100 dialog opened
    // by the OS close request, which produces no pointerdown to close it).
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.appendChild(appRoot)
    await render(<GameRowProfileMenu {...staticProps()}>{primaryButton}</GameRowProfileMenu>)

    const menu = document.body.querySelector('[role="menu"]')
    expect(menu).not.toBeNull()
    expect(appRoot.contains(menu)).toBe(true)

    appRoot.setAttribute('inert', '')
    expect(menu!.closest('[inert]')).toBe(appRoot)

    // Above everything inside the app (nothing there is above z-40), below
    // every dialog (z-100 and up in body).
    const wrapper = menu!.parentElement!
    expect(wrapper.classList.contains('z-50')).toBe(true)
    expect(wrapper.classList.contains('z-9999')).toBe(false)
  })

  test('a press inside the portalled menu keeps it open; a press elsewhere closes it', async () => {
    await render(<Harness />)

    const item = document.body.querySelector('[role="menuitemradio"]')
    expect(item).not.toBeNull()

    await act(async () => {
      pressOn(item!)
    })
    expect(document.body.querySelector('[role="menu"]')).not.toBeNull()

    await act(async () => {
      pressOn(document.body)
    })
    expect(document.body.querySelector('[role="menu"]')).toBeNull()
  })
})
