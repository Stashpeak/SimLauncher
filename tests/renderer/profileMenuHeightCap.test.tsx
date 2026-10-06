/**
 * #954: the profile menu had no height limit. With many profiles, or a large
 * zoom, it grew over the header and then off the screen, and the profiles
 * that fell off could not be reached: `flip` and `shift` only move a box, and
 * the surface was overflow-hidden, so even a cap would have clipped silently.
 *
 * Now `size` hands the room on the chosen side to the menu as
 * --menu-max-height, the profile list scrolls inside it, and New profile stays
 * pinned below the list (David's call on #954). Arrow keys scroll only that
 * list, never the page (#948). jsdom has no layout, so this pins the structure,
 * the scroll arithmetic with stated dimensions, and how focus is moved; the
 * real heights are measured on a packaged build.
 */
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest'
import { act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'

import { GameRowProfileMenu } from '../../src/renderer/src/components/game-list/GameRowProfileMenu'
import { useProfileMenu } from '../../src/renderer/src/hooks/useProfileMenu'
import { revealInMenuList } from '../../src/renderer/src/lib/menuScroll'
import type { GameProfileSet } from '../../src/renderer/src/lib/config'

beforeAll(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
})

const PROFILE_SET: GameProfileSet = {
  activeProfileId: 'p03',
  profiles: Array.from({ length: 14 }, (_, index) => {
    const n = String(index + 1).padStart(2, '0')
    return { id: `p${n}`, name: `Profile ${n}`, utilities: [] }
  })
}

// The real hook, so focus moves the way the shipped keyboard handling moves it.
function Harness(): ReactNode {
  const menu = useProfileMenu()
  useEffect(() => {
    menu.openProfileMenu()
    // Open once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <GameRowProfileMenu
      profileSet={PROFILE_SET}
      activeProfile={PROFILE_SET.profiles[2]}
      {...menu}
      gameName="iRacing"
      onProfileSelect={vi.fn()}
      onNewProfileSubmit={vi.fn()}
    />
  )
}

let root: Root | null = null

async function render(): Promise<void> {
  const container = document.createElement('div')
  document.body.appendChild(container)
  await act(async () => {
    root = createRoot(container)
    root.render(<Harness />)
  })
}

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

const menu = () => document.body.querySelector<HTMLElement>('[role="menu"]')!
const list = () => menu().querySelector<HTMLElement>('[data-menu-list]')!

describe('the profile menu is capped and scrolls its profiles (#954)', () => {
  test('the surface takes its cap from size, and only the profile list scrolls', async () => {
    await render()
    expect(menu().className).toContain('max-h-(--menu-max-height)')
    expect(menu().className).toContain('flex-col')

    const scroller = list()
    expect(scroller.className).toContain('overflow-y-auto')
    expect(scroller.className).toContain('min-h-0')
    // relative: the scroller is the items' offsetParent, which the reveal
    // arithmetic relies on.
    expect(scroller.className).toContain('relative')
    expect(scroller.querySelectorAll('[role="menuitemradio"]')).toHaveLength(14)
  })

  test('New profile stays pinned below the list, outside what scrolls', async () => {
    await render()
    const newProfile = Array.from(menu().querySelectorAll('button')).find((button) =>
      button.textContent?.includes('New profile')
    )
    expect(newProfile).toBeDefined()
    expect(list().contains(newProfile!)).toBe(false)
    expect(newProfile!.className).toContain('shrink-0')
  })

  test('arrow keys move focus without the browser scroll, so the page stays put (#948)', async () => {
    await render()
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus')
    await act(async () => {
      menu().dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
      )
    })
    const itemCalls = focusSpy.mock.contexts
      .map((element, index) => ({
        element: element as HTMLElement,
        args: focusSpy.mock.calls[index]
      }))
      .filter(({ element }) => element.getAttribute('role') === 'menuitemradio')
    expect(itemCalls.length).toBeGreaterThan(0)
    for (const { args } of itemCalls) expect(args).toEqual([{ preventScroll: true }])
  })
})

describe('revealInMenuList scrolls only the menu list, just enough (#954)', () => {
  // A 200px tall list, scrolled 100px down, with a 40px item at `top`.
  function setup(top: number): { scroller: HTMLElement; item: HTMLElement } {
    const scroller = document.createElement('div')
    scroller.setAttribute('data-menu-list', '')
    const item = document.createElement('button')
    scroller.appendChild(item)
    document.body.appendChild(scroller)
    Object.defineProperty(scroller, 'clientHeight', { value: 200 })
    scroller.scrollTop = 100
    Object.defineProperty(item, 'offsetTop', { value: top })
    Object.defineProperty(item, 'offsetHeight', { value: 40 })
    return { scroller, item }
  }

  test('an item below the visible part brings its bottom edge to the bottom', () => {
    const { scroller, item } = setup(400)
    revealInMenuList(item)
    expect(scroller.scrollTop).toBe(400 + 40 - 200)
  })

  test('an item above the visible part brings its top edge to the top', () => {
    const { scroller, item } = setup(20)
    revealInMenuList(item)
    expect(scroller.scrollTop).toBe(20)
  })

  test('an item already visible leaves the list where it is', () => {
    const { scroller, item } = setup(150)
    revealInMenuList(item)
    expect(scroller.scrollTop).toBe(100)
  })

  test('an item outside any menu list (the pinned New profile) changes nothing', () => {
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    expect(() => revealInMenuList(outside)).not.toThrow()
  })
})
