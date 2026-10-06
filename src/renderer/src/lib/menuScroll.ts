/**
 * Scrolls a menu's own scrolling list (the element marked `data-menu-list`)
 * just enough to show `item` (#954), and nothing else: not the page, not the
 * games view (#948). An item outside any such list, like the profile menu's
 * pinned New profile, is always visible and needs nothing. The list must be
 * `position: relative`, so it is the item's offsetParent.
 */
export function revealInMenuList(item: HTMLElement): void {
  const list = item.closest<HTMLElement>('[data-menu-list]')
  if (!list) return
  const top = item.offsetTop
  const bottom = top + item.offsetHeight
  if (top < list.scrollTop) {
    list.scrollTop = top
  } else if (bottom > list.scrollTop + list.clientHeight) {
    list.scrollTop = bottom - list.clientHeight
  }
}
