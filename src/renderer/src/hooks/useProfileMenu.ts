import { type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react'

export function useProfileMenu() {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [newProfileFormOpen, setNewProfileFormOpen] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const profileMenuRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const newProfileInputRef = useRef<HTMLInputElement | null>(null)
  const focusSelectedOnOpenRef = useRef(false)

  const focusTrigger = useCallback(() => {
    window.requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  const getMenuItems = useCallback(() => {
    return Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"], [role="menuitem"]'
      ) ?? []
    )
  }, [])

  const focusMenuItem = useCallback(
    (index: number) => {
      const items = getMenuItems()

      if (items.length === 0) {
        return
      }

      const nextIndex = (index + items.length) % items.length
      items[nextIndex]?.focus()
    },
    [getMenuItems]
  )

  const focusSelectedProfile = useCallback(() => {
    const items = getMenuItems()

    if (items.length === 0) {
      return
    }

    const selectedIndex = items.findIndex((item) => item.getAttribute('aria-checked') === 'true')
    focusMenuItem(selectedIndex === -1 ? 0 : selectedIndex)
  }, [focusMenuItem, getMenuItems])

  const openProfileMenu = useCallback((focusSelectedProfileOnOpen = false) => {
    focusSelectedOnOpenRef.current = focusSelectedProfileOnOpen
    setProfileMenuOpen(true)
  }, [])

  const closeProfileMenu = useCallback(
    (returnFocusToTrigger = false) => {
      focusSelectedOnOpenRef.current = false
      setProfileMenuOpen(false)
      setNewProfileFormOpen(false)
      setNewProfileName('')

      if (returnFocusToTrigger) {
        focusTrigger()
      }
    },
    [focusTrigger]
  )

  useEffect(() => {
    if (!profileMenuOpen) {
      setNewProfileFormOpen(false)
      setNewProfileName('')
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        closeProfileMenu(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)

    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [closeProfileMenu, profileMenuOpen])

  useEffect(() => {
    if (!profileMenuOpen || !focusSelectedOnOpenRef.current || newProfileFormOpen) {
      return
    }

    focusSelectedOnOpenRef.current = false
    window.requestAnimationFrame(focusSelectedProfile)
  }, [focusSelectedProfile, newProfileFormOpen, profileMenuOpen])

  useEffect(() => {
    if (!profileMenuOpen || !newProfileFormOpen) {
      return
    }

    newProfileInputRef.current?.focus()
  }, [profileMenuOpen, newProfileFormOpen])

  const handleProfileMenuTriggerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>) => {
      if (event.key !== 'ArrowDown' && event.key !== 'Enter' && event.key !== ' ') {
        return
      }

      event.preventDefault()
      event.stopPropagation()

      if (profileMenuOpen) {
        focusSelectedProfile()
        return
      }

      openProfileMenu(true)
    },
    [focusSelectedProfile, openProfileMenu, profileMenuOpen]
  )

  const handleProfileMenuKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      const target = event.target as HTMLElement
      const isTextInput =
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        closeProfileMenu(true)
        return
      }

      if (event.key === 'Tab') {
        event.preventDefault()
        event.stopPropagation()
        closeProfileMenu(true)
        return
      }

      if (isTextInput) {
        return
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        event.stopPropagation()

        const items = getMenuItems()

        if (items.length === 0) {
          return
        }

        const currentIndex = items.findIndex((item) => item === document.activeElement)
        const nextIndex =
          currentIndex === -1
            ? event.key === 'ArrowDown'
              ? 0
              : items.length - 1
            : currentIndex + (event.key === 'ArrowDown' ? 1 : -1)

        focusMenuItem(nextIndex)
        return
      }

      if (event.key === 'Enter' || event.key === ' ') {
        const menuItem = target.closest<HTMLButtonElement>(
          '[role="menuitemradio"], [role="menuitem"]'
        )

        if (!menuItem || menuItem.disabled) {
          return
        }

        event.preventDefault()
        event.stopPropagation()
        menuItem.click()
      }
    },
    [closeProfileMenu, focusMenuItem, getMenuItems]
  )

  return {
    profileMenuOpen,
    setProfileMenuOpen,
    openProfileMenu,
    closeProfileMenu,
    newProfileFormOpen,
    setNewProfileFormOpen,
    newProfileName,
    setNewProfileName,
    profileMenuRef,
    menuRef,
    triggerRef,
    handleProfileMenuTriggerKeyDown,
    handleProfileMenuKeyDown,
    newProfileInputRef
  }
}
