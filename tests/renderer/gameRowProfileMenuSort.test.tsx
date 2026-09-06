/**
 * The row dropdown listed profiles in storage order, which is creation order,
 * so where a profile sat depended on when it happened to be made (#885). The
 * menu now renders a copy sorted by name and leaves the stored order alone: the
 * active profile is found by id rather than by position, so it stays marked
 * wherever it lands, and a rename moves the profile to its new place on the
 * next render.
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import {
  GameRowProfileMenu,
  type GameRowProfileMenuProps
} from '../../src/renderer/src/components/game-list/GameRowProfileMenu'
import type { GameProfileSet, NamedGameProfile } from '../../src/renderer/src/lib/config'

let root: Root | null = null
let container: HTMLElement | null = null

function profile(id: string, name: string): NamedGameProfile {
  return { id, name, utilities: [] }
}

function profileSetOf(activeProfileId: string, ...profiles: NamedGameProfile[]): GameProfileSet {
  return { activeProfileId, profiles }
}

function menuProps(profileSet: GameProfileSet): GameRowProfileMenuProps {
  const activeProfile =
    profileSet.profiles.find((entry) => entry.id === profileSet.activeProfileId) ??
    profileSet.profiles[0]
  return {
    profileSet,
    activeProfile,
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
    onNewProfileSubmit: vi.fn()
  }
}

// Re-rendering into the same root is what a rename does in the app: the row
// hands the menu a new profile set, the menu is not remounted.
async function renderMenu(
  profileSet: GameProfileSet,
  overrides: Partial<GameRowProfileMenuProps> = {}
): Promise<HTMLElement> {
  if (!container) {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  }
  await act(async () => {
    root?.render(<GameRowProfileMenu {...menuProps(profileSet)} {...overrides} />)
  })
  return container
}

// The menu is portalled to document.body (#884), so the queries go there
// rather than into the render container.
function renderedNames(): string[] {
  return Array.from(document.body.querySelectorAll('[role="menuitemradio"]')).map(
    (item) => item.textContent?.trim() ?? ''
  )
}

afterEach(() => {
  act(() => {
    root?.unmount()
  })
  root = null
  container?.remove()
  container = null
  document.body.innerHTML = ''
})

describe('GameRowProfileMenu profile order (#885)', () => {
  test('lists profiles by name, not by when they were created', async () => {
    await renderMenu(
      profileSetOf(
        'road',
        profile('road', 'VR - Road'),
        profile('ott', 'OTT + Cheat Engine'),
        profile('dirt', 'VR - Dirt'),
        profile('single', 'Single Monitor'),
        profile('test', '1.2.0 Test')
      )
    )

    expect(renderedNames()).toEqual([
      '1.2.0 Test',
      'OTT + Cheat Engine',
      'Single Monitor',
      'VR - Dirt',
      'VR - Road'
    ])
  })

  test('orders by letter regardless of case, and by number inside a name', async () => {
    await renderMenu(
      profileSetOf(
        'z',
        profile('z', 'Zeta'),
        profile('p10', 'profile 10'),
        profile('a', 'alpha'),
        profile('p2', 'Profile 2'),
        profile('b', 'Beta')
      )
    )

    // A code-point sort would put "Zeta" and "Profile 2" ahead of "alpha" (every
    // capital sorts before every lowercase letter) and "profile 10" ahead of
    // "Profile 2" ("1" < "2").
    expect(renderedNames()).toEqual(['alpha', 'Beta', 'Profile 2', 'profile 10', 'Zeta'])
  })

  test('the active profile stays marked wherever sorting puts it', async () => {
    await renderMenu(
      profileSetOf(
        'late',
        profile('first', 'Beta'),
        profile('second', 'Gamma'),
        // Created last, sorts first: position and identity must not be confused.
        profile('late', 'alpha')
      )
    )

    const checked = Array.from(document.body.querySelectorAll('[role="menuitemradio"]')).filter(
      (item) => item.getAttribute('aria-checked') === 'true'
    )
    expect(checked.map((item) => item.textContent?.trim())).toEqual(['alpha'])
    expect(renderedNames()[0]).toBe('alpha')
  })

  test('selecting an item reports the id of the profile shown, not a position', async () => {
    const onProfileSelect = vi.fn()
    await renderMenu(profileSetOf('first', profile('first', 'Beta'), profile('second', 'alpha')), {
      onProfileSelect
    })

    const items = Array.from(
      document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')
    )
    expect(items[0]?.textContent?.trim()).toBe('alpha')
    await act(async () => {
      items[0]?.click()
    })

    expect(onProfileSelect).toHaveBeenCalledWith('second')
  })

  test('leaves the stored order alone', async () => {
    const profileSet = profileSetOf(
      'road',
      profile('road', 'VR - Road'),
      profile('test', '1.2.0 Test'),
      profile('dirt', 'VR - Dirt')
    )
    const storedOrder = profileSet.profiles.map((entry) => entry.id)

    await renderMenu(profileSet)

    expect(profileSet.profiles.map((entry) => entry.id)).toEqual(storedOrder)
  })

  test('a renamed profile moves to its new place', async () => {
    const before = profileSetOf('b', profile('b', 'Beta'), profile('a', 'alpha'))
    await renderMenu(before)
    expect(renderedNames()).toEqual(['alpha', 'Beta'])

    const after = profileSetOf('b', profile('b', 'Aardvark'), profile('a', 'alpha'))
    await renderMenu(after)

    expect(renderedNames()).toEqual(['Aardvark', 'alpha'])
  })
})
