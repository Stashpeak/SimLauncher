/**
 * #954, the two halves profileMenuHeightCap.test.tsx cannot reach without
 * layout (review bot on PR #1021): what the `size` middleware writes, and the
 * scroll to the active profile once the menu is positioned. useFloating is
 * wrapped to report the menu as positioned once its floating element exists,
 * and to expose the options it was given; the list's dimensions are stated,
 * since jsdom has none.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'

interface SizeOptions {
  apply: (state: { availableHeight: number; elements: { floating: HTMLElement } }) => void
}
let lastOptions: { middleware?: Array<{ name: string; options?: unknown }> } = {}

vi.mock('@floating-ui/react', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@floating-ui/react')>()
  return {
    ...actual,
    useFloating: (options?: Parameters<typeof actual.useFloating>[0]) => {
      if ((options as { placement?: string } | undefined)?.placement === 'bottom-end') {
        lastOptions = options as typeof lastOptions
      }
      const result = actual.useFloating(options)
      // Positioned once the floating element is mounted, as in the app. The
      // portal mounts a render after the open, so a constant true would let
      // the reveal run before there is any menu to scroll.
      return { ...result, isPositioned: result.elements.floating != null }
    }
  }
})

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

import { GameRowProfileMenu } from '../../src/renderer/src/components/game-list/GameRowProfileMenu'
import type { GameProfileSet } from '../../src/renderer/src/lib/config'

const PROFILE_SET: GameProfileSet = {
  activeProfileId: 'p13',
  profiles: Array.from({ length: 14 }, (_, index) => {
    const n = String(index + 1).padStart(2, '0')
    return { id: `p${n}`, name: `Profile ${n}`, utilities: [] }
  })
}

const ITEM_HEIGHT = 40
const LIST_HEIGHT = 200

let root: Root | null = null
const restore: Array<() => void> = []

// A 200px list of 40px items: item n sits at n * 40 inside it.
function stateLayout(): void {
  const define = (prop: string, get: (this: HTMLElement) => number) => {
    const original = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
    Object.defineProperty(HTMLElement.prototype, prop, { configurable: true, get })
    restore.push(() => {
      if (original) Object.defineProperty(HTMLElement.prototype, prop, original)
    })
  }
  define('offsetTop', function () {
    const parent = this.parentElement
    if (!parent?.hasAttribute('data-menu-list')) return 0
    return Array.from(parent.children).indexOf(this) * ITEM_HEIGHT
  })
  define('offsetHeight', () => ITEM_HEIGHT)
  define('clientHeight', function () {
    return this.hasAttribute('data-menu-list') ? LIST_HEIGHT : 0
  })
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  while (restore.length) restore.pop()!()
})

async function renderOpenMenu(): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(
      <GameRowProfileMenu
        profileSet={PROFILE_SET}
        activeProfile={PROFILE_SET.profiles[12]}
        profileMenuOpen
        openProfileMenu={vi.fn()}
        closeProfileMenu={vi.fn()}
        profileMenuRef={{ current: null }}
        menuRef={{ current: null }}
        triggerRef={{ current: null }}
        handleProfileMenuTriggerKeyDown={vi.fn()}
        handleProfileMenuKeyDown={vi.fn()}
        newProfileFormOpen={false}
        newProfileName=""
        setNewProfileName={vi.fn()}
        newProfileInputRef={{ current: null }}
        gameName="iRacing"
        onProfileSelect={vi.fn()}
        onNewProfileSubmit={vi.fn()}
      />
    )
  })
  return document.body.querySelector<HTMLElement>('[data-menu-list]')!
}

describe('profile menu cap and open-time reveal (#954)', () => {
  test('size writes the room on the chosen side as --menu-max-height, never negative', async () => {
    await renderOpenMenu()
    const size = lastOptions.middleware?.find((entry) => entry.name === 'size')
    expect(size).toBeDefined()
    // @floating-ui/react keeps [options, deps] on its middleware wrappers.
    const raw = size!.options as SizeOptions | [SizeOptions, unknown]
    const apply = (Array.isArray(raw) ? raw[0] : raw).apply
    const floating = document.createElement('div')

    apply({ availableHeight: 321.5, elements: { floating } })
    expect(floating.style.getPropertyValue('--menu-max-height')).toBe('321.5px')

    apply({ availableHeight: -12, elements: { floating } })
    expect(floating.style.getPropertyValue('--menu-max-height')).toBe('0px')
  })

  test('once positioned, the menu scrolls its list to the active profile', async () => {
    stateLayout()
    const list = await renderOpenMenu()
    // Profile 13 is the 13th item: top 480, bottom 520, so its bottom edge
    // comes to the bottom of a 200px list.
    expect(list.scrollTop).toBe(12 * ITEM_HEIGHT + ITEM_HEIGHT - LIST_HEIGHT)
  })
})
