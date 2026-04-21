import { useEffect, useRef, useState } from 'react'

export function useProfileMenu() {
  const [profileMenuOpen, setProfileMenuOpen] = useState(false)
  const [newProfileFormOpen, setNewProfileFormOpen] = useState(false)
  const [newProfileName, setNewProfileName] = useState('')
  const profileMenuRef = useRef<HTMLDivElement | null>(null)
  const newProfileInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!profileMenuOpen) {
      setNewProfileFormOpen(false)
      setNewProfileName('')
      return
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setProfileMenuOpen(false)
        setNewProfileFormOpen(false)
        setNewProfileName('')
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)

    return () => window.removeEventListener('pointerdown', handlePointerDown)
  }, [profileMenuOpen])

  useEffect(() => {
    if (!profileMenuOpen || !newProfileFormOpen) {
      return
    }

    newProfileInputRef.current?.focus()
  }, [profileMenuOpen, newProfileFormOpen])

  return {
    profileMenuOpen,
    setProfileMenuOpen,
    newProfileFormOpen,
    setNewProfileFormOpen,
    newProfileName,
    setNewProfileName,
    profileMenuRef,
    newProfileInputRef
  }
}
