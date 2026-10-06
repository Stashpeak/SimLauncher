import { useCallback, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react'
import { getCustomUtilityKey, type Profiles } from '../../lib/config'
import { ConfirmDialog } from '../ConfirmDialog'
import { shiftCustomSlotRecord, shiftCustomSlotSet, shiftProfileCustomSlots } from './customSlots'
import type { SettingsObjectField } from './saveRace'

export interface UseCustomSlotsResult {
  handleAddCustomSlot: () => void
  handleRemoveCustomSlot: (slotNumber: number) => void
  customSlotRemoveDialog: ReactNode
}

interface UseCustomSlotsArgs {
  appNames: Record<string, string>
  appPaths: Record<string, string>
  customSlots: number
  notify: (message: string, type: 'success' | 'error' | 'warn', duration?: number) => void
  updateSettingsObject: (
    field: SettingsObjectField,
    setter: Dispatch<SetStateAction<Record<string, string>>>,
    updater: (current: Record<string, string>) => Record<string, string>
  ) => void
  setAppPaths: Dispatch<SetStateAction<Record<string, string>>>
  setAppNames: Dispatch<SetStateAction<Record<string, string>>>
  setAppArgs: Dispatch<SetStateAction<Record<string, string>>>
  setAppIcons: Dispatch<SetStateAction<Record<string, string>>>
  setIconLoadErrors: Dispatch<SetStateAction<Set<string>>>
  setProfiles: Dispatch<SetStateAction<Profiles>>
  setCustomSlots: Dispatch<SetStateAction<number>>
}

export function useCustomSlots({
  appNames,
  appPaths,
  customSlots,
  notify,
  updateSettingsObject,
  setAppPaths,
  setAppNames,
  setAppArgs,
  setAppIcons,
  setIconLoadErrors,
  setProfiles,
  setCustomSlots
}: UseCustomSlotsArgs): UseCustomSlotsResult {
  const [customSlotRemoveConfirm, setCustomSlotRemoveConfirm] = useState<{
    slotNumber: number
    slotName: string
  } | null>(null)

  const removeSlotData = useCallback(
    (slotNumber: number) => {
      // Every slot below the one removed shifts the NEXT slot's data into its
      // own React-keyed row, so that row stays mounted (just repainted) and
      // ConfirmDialog's useFocusTrap restore (or, on the silent no-dialog
      // path, the browser's own focus retention) lands on it correctly. The
      // highest-numbered slot is the exception: shiftCustomSlotRecord has
      // nothing left to shift into it, so removing IT is the one case where
      // the row carrying the just-clicked Remove button unmounts with no
      // surviving node for focus to land on (#1007). Capture that case before
      // the shift so the fallback below only fires when it is actually needed.
      const removingHighestSlot = slotNumber === customSlots

      updateSettingsObject('appPaths', setAppPaths, (current) =>
        shiftCustomSlotRecord(current, slotNumber, customSlots)
      )
      updateSettingsObject('appNames', setAppNames, (current) =>
        shiftCustomSlotRecord(current, slotNumber, customSlots)
      )
      updateSettingsObject('appArgs', setAppArgs, (current) =>
        shiftCustomSlotRecord(current, slotNumber, customSlots)
      )
      setAppIcons((current) => shiftCustomSlotRecord(current, slotNumber, customSlots))
      setIconLoadErrors((current) => shiftCustomSlotSet(current, slotNumber, customSlots))
      setProfiles((current) => {
        const nextProfiles: Profiles = {}

        Object.entries(current).forEach(([gameKey, profile]) => {
          nextProfiles[gameKey] = shiftProfileCustomSlots(profile, slotNumber, customSlots)
        })

        return nextProfiles
      })
      setCustomSlots((current) => Math.max(1, current - 1))

      if (removingHighestSlot) {
        // handleRemoveCustomSlot already refused to get here with only one
        // slot left (it notifies and returns instead), so a slot survives and
        // has a Remove button; focus the last one (the new highest slot) once
        // React has committed the removal. No preventScroll: this is a new
        // target, not a hand-back to where the user just was, so the default
        // scroll is what reveals it if the list has scrolled (#948).
        window.requestAnimationFrame(() => {
          const survivors = document.querySelectorAll<HTMLButtonElement>(
            'button[aria-label^="Remove "]'
          )
          survivors[survivors.length - 1]?.focus()
        })
      }
    },
    [
      customSlots,
      setAppArgs,
      setAppIcons,
      setAppNames,
      setAppPaths,
      setCustomSlots,
      setIconLoadErrors,
      setProfiles,
      updateSettingsObject
    ]
  )

  const handleAddCustomSlot = useCallback(() => {
    setCustomSlots((current) => current + 1)
  }, [setCustomSlots])

  const handleRemoveCustomSlot = useCallback(
    (slotNumber: number) => {
      if (customSlots <= 1) {
        notify('At least one custom app slot is required', 'warn')
        return
      }

      const slotKey = getCustomUtilityKey(slotNumber)
      const slotName = appNames[slotKey] || `Custom App ${slotNumber}`

      // Only show the destructive-action confirmation when the slot actually has
      // an executable configured. An empty slot can be removed silently.
      if (appPaths[slotKey]) {
        setCustomSlotRemoveConfirm({ slotNumber, slotName })
        return
      }

      setCustomSlotRemoveConfirm(null)
      removeSlotData(slotNumber)
    },
    [appNames, appPaths, customSlots, notify, removeSlotData]
  )

  const handleConfirmRemoveCustomSlot = useCallback(() => {
    if (!customSlotRemoveConfirm) return

    const slotNumber = customSlotRemoveConfirm.slotNumber
    setCustomSlotRemoveConfirm(null)
    removeSlotData(slotNumber)
  }, [customSlotRemoveConfirm, removeSlotData])

  const customSlotRemoveDialog = (
    <ConfirmDialog
      isOpen={customSlotRemoveConfirm !== null}
      title="Remove Custom App"
      message={`Remove ${customSlotRemoveConfirm?.slotName || 'this custom app'} and its executable path?`}
      saveLabel="Remove App"
      discardLabel="Keep App"
      saveClassName="danger-action"
      discardClassName="neutral-action"
      onSave={handleConfirmRemoveCustomSlot}
      onDiscard={() => setCustomSlotRemoveConfirm(null)}
      onCancel={() => setCustomSlotRemoveConfirm(null)}
    />
  )

  return { handleAddCustomSlot, handleRemoveCustomSlot, customSlotRemoveDialog }
}
