import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  createProfileId,
  getActiveGameProfile,
  type Game,
  type NamedGameProfile
} from '../../lib/config'
import { ProfileEditor } from '../ProfileEditor'
import { useNotify } from '../Notify'
import {
  getProfileSwitchDiff,
  switchProfileApps,
  launchProfile,
  killLaunchedApps,
  relaunchMissingProfile
} from '../../lib/electron'
import { formatKillFailures } from '../../lib/killFailures'
import { useGameProfile } from '../../hooks/useGameProfile'
import { useProfileMenu } from '../../hooks/useProfileMenu'
import { GameIcon } from './GameIcon'
import { RunningAppsStrip, type RunningAppIcon } from './RunningAppsStrip'
import { GameRowActions } from './GameRowActions'
import { ConfirmDialog } from '../ConfirmDialog'
import { useAppDirty } from '../../contexts/AppDirtyContext'

const POST_LAUNCH_BLOCK_MS = 10000

export function GameRow({
  game,
  isActive,
  isRunning,
  runningAppIcons,
  gameIconUrl,
  isDimmed,
  isLaunching,
  isLaunchBlocked,
  onLaunchStart,
  onLaunchEnd,
  onRunningStateRefresh,
  onToggleEditor,
  onCloseEditor,
  cacheInitialized
}: {
  game: Game
  isActive: boolean
  isRunning: boolean
  runningAppIcons: RunningAppIcon[]
  gameIconUrl?: string
  isDimmed: boolean
  isLaunching: boolean
  isLaunchBlocked: boolean
  onLaunchStart: (gameKey: string) => void
  onLaunchEnd: (gameKey: string, cooldownMs?: number) => void
  onRunningStateRefresh: () => Promise<void>
  onToggleEditor: () => void
  // Explicit close for this row's editor (key-guarded functional update) so the
  // async discard path can close without a stale toggle reopening/closing the
  // wrong row if the user opens another editor mid-await (#453 Codex P2).
  onCloseEditor: () => void
  cacheInitialized: boolean
}): ReactNode {
  const { notify } = useNotify()
  const [profileSwitchConfirm, setProfileSwitchConfirm] = useState<{
    nextProfileId: string
    nextProfileName: string
    message: string
  } | null>(null)
  const {
    profileMenuOpen,
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
  } = useProfileMenu()
  const { profileSet, profileState, loadProfileSet, getProfileRuntimeConfig, saveProfileSet } =
    useGameProfile(game.key, isActive)

  // Tracks a profile created by the editor "+" that has not yet been kept on
  // purpose (saved / launched / switched-away-from). If the editor is closed
  // while this is set, the profile is removed and the previously-active profile
  // is restored, so create-then-discard leaves no orphan (#453). A ref (not
  // state) so the close handler reads the latest value synchronously and a
  // deliberate save can clear it before its own onClose fires.
  const pendingNewProfileRef = useRef<{
    newProfileId: string
    previousActiveProfileId: string
  } | null>(null)

  const handleCreateProfile = async (name: string, options?: { trackAsPending?: boolean }) => {
    const trimmedName = name.trim()

    if (trimmedName.length === 0) {
      return
    }

    const nextProfileSet = await getProfileRuntimeConfig()
    const activeProfile = getActiveGameProfile(nextProfileSet)

    // If a previous editor "+" creation is still pending (never kept), drop it
    // so chaining "Discard & Create New" doesn't leak an orphan, and carry its
    // original previous-active id forward so discarding the new profile still
    // restores the profile the user actually started from (#453).
    const existingPending = options?.trackAsPending ? pendingNewProfileRef.current : null
    const baseProfiles = existingPending
      ? nextProfileSet.profiles.filter((profile) => profile.id !== existingPending.newProfileId)
      : nextProfileSet.profiles
    const previousActiveProfileId = existingPending
      ? existingPending.previousActiveProfileId
      : nextProfileSet.activeProfileId

    const newProfile: NamedGameProfile = {
      ...JSON.parse(JSON.stringify(activeProfile)),
      id: createProfileId(),
      name: trimmedName
    }
    const updatedProfileSet = {
      activeProfileId: newProfile.id,
      profiles: [...baseProfiles, newProfile]
    }

    await saveProfileSet(updatedProfileSet)
    pendingNewProfileRef.current = options?.trackAsPending
      ? { newProfileId: newProfile.id, previousActiveProfileId }
      : null
    notify(`Created profile ${newProfile.name}`, 'success')
  }

  // When this row's editor closes for ANY reason -- explicit close / discard, or
  // being collapsed because another row's (or Settings') editor was opened -- a
  // still-pending "+" profile (never kept) is removed and the previously-active
  // profile restored, so create-then-discard leaves no orphan (#453). Living in
  // an isActive effect rather than the close handler so it also catches the
  // close-by-opening-another-row path, which never routes through onClose.
  useEffect(() => {
    if (isActive || !pendingNewProfileRef.current) {
      return
    }
    const pending = pendingNewProfileRef.current
    pendingNewProfileRef.current = null
    void (async () => {
      const latest = await getProfileRuntimeConfig()
      if (!latest.profiles.some((profile) => profile.id === pending.newProfileId)) {
        return
      }
      const remaining = latest.profiles.filter((profile) => profile.id !== pending.newProfileId)
      if (remaining.length === 0) {
        return
      }
      const restoreId = remaining.some((profile) => profile.id === pending.previousActiveProfileId)
        ? pending.previousActiveProfileId
        : remaining[0].id
      await saveProfileSet({ activeProfileId: restoreId, profiles: remaining })
    })()
  }, [isActive, getProfileRuntimeConfig, saveProfileSet])

  const switchToProfile = async (nextProfileId: string, skipRunningConfirm = false) => {
    if (nextProfileId === '__new__') {
      setNewProfileFormOpen(true)
      return
    }

    if (nextProfileId === profileSet.activeProfileId) {
      closeProfileMenu(true)
      return
    }

    if (isRunning && isLaunchBlocked) {
      notify('Launch is settling. Try again shortly.', 'warn')
      return
    }

    const latestProfileSet = await getProfileRuntimeConfig()
    const currentProfile = getActiveGameProfile(latestProfileSet)
    const nextProfile = latestProfileSet.profiles.find((profile) => profile.id === nextProfileId)

    if (!nextProfile) {
      return
    }

    const updatedProfileSet = {
      ...latestProfileSet,
      activeProfileId: nextProfile.id
    }

    try {
      let switchWarning: string | undefined

      if (isRunning) {
        const diff = await getProfileSwitchDiff(game.key, currentProfile.id, nextProfile.id)

        if (diff.toStopCount > 0 || diff.toStartCount > 0) {
          const parts: string[] = []
          if (diff.toStopCount > 0) parts.push(`stop ${diff.toStopCount} app(s)`)
          if (diff.toStartCount > 0) parts.push(`start ${diff.toStartCount} app(s)`)
          const message = `Switch to "${nextProfile.name}" while the game is running? This will ${parts.join(' and ')}.`

          if (!skipRunningConfirm) {
            setProfileSwitchConfirm({
              nextProfileId: nextProfile.id,
              nextProfileName: nextProfile.name,
              message
            })
            return
          }

          onLaunchStart(game.key)
          const result = await switchProfileApps(game.key, currentProfile.id, nextProfile.id)
          if (!result.success) {
            notify(result.error || 'Failed to switch profile', 'error')
            onLaunchEnd(game.key, result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS)
            return
          }
          onLaunchEnd(game.key, result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS)

          const switchWarnings: string[] = []
          if (result.killFailures && result.killFailures.length > 0) {
            switchWarnings.push(formatKillFailures(result.killFailures))
          }
          if (result.warning) {
            switchWarnings.push(result.warning)
          }
          switchWarning = switchWarnings.length > 0 ? switchWarnings.join(' ') : undefined
        }

        await onRunningStateRefresh()
      }

      await saveProfileSet(updatedProfileSet)
      // Switching to another profile keeps the pending "+" profile on purpose,
      // so it's no longer a discard-on-close candidate (#453).
      pendingNewProfileRef.current = null
      closeProfileMenu(true)
      notify(
        switchWarning || `Switched to ${nextProfile.name}`,
        switchWarning ? 'warn' : 'success',
        switchWarning ? 5000 : undefined
      )
    } catch (err) {
      onLaunchEnd(game.key, 0)
      notify('Failed to switch profile', 'error')
      console.error(err)
    }
  }

  const handleProfileSelect = (nextProfileId: string) => {
    void switchToProfile(nextProfileId)
  }

  const handleConfirmProfileSwitch = () => {
    if (!profileSwitchConfirm) return

    const nextProfileId = profileSwitchConfirm.nextProfileId
    setProfileSwitchConfirm(null)
    void switchToProfile(nextProfileId, true)
  }

  const handleNewProfileSubmit = async () => {
    const trimmedName = newProfileName.trim()

    if (trimmedName.length === 0) {
      return
    }

    await handleCreateProfile(trimmedName)
    setNewProfileName('')
    setNewProfileFormOpen(false)
    closeProfileMenu(true)
  }

  const handleLaunchRequest = useRef<(() => void) | null>(null)

  const handleLaunch = async () => {
    if (isActive && handleLaunchRequest.current) {
      handleLaunchRequest.current()
      return
    }

    if (isLaunchBlocked) {
      return
    }

    let cooldownMs = 0

    try {
      onLaunchStart(game.key)
      const result = await launchProfile(game.key)
      if (!result.success) {
        cooldownMs = result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS
        notify(result.error || 'Failed to launch profile', 'error')
        return
      }

      cooldownMs = result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS
      notify(
        result.warning || result.message || `Launching ${game.name}`,
        result.warning ? 'warn' : 'success',
        result.warning ? 5000 : undefined
      )
    } catch (err) {
      notify('Failed to launch profile', 'error')
      console.error(err)
    } finally {
      onLaunchEnd(game.key, cooldownMs)
    }
  }

  const handleKill = async () => {
    try {
      const result = await killLaunchedApps(game.key)
      await onRunningStateRefresh()

      if (!result.success) {
        const message = result.error || formatKillFailures(result.failures)
        notify(message, 'warn', 6000)
        return
      }

      notify(result.message || `Closing companion apps for ${game.name}`, 'warn')
    } catch (err) {
      notify('Failed to close companion apps', 'error')
      console.error(err)
    }
  }

  const handleRelaunchMissing = async () => {
    if (isLaunchBlocked) {
      return
    }

    let cooldownMs = 0

    try {
      onLaunchStart(game.key)
      const result = await relaunchMissingProfile(game.key)
      if (!result.success) {
        cooldownMs = result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS
        notify(result.error || 'Failed to relaunch missing apps', 'error')
        return
      }

      cooldownMs = result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS
      notify(
        result.warning || result.message || 'Relaunching missing apps',
        result.warning ? 'warn' : 'success',
        result.warning ? 5000 : undefined
      )
    } catch (err) {
      notify('Failed to relaunch missing apps', 'error')
      console.error(err)
    } finally {
      onLaunchEnd(game.key, cooldownMs)
    }
  }

  const rowRef = useRef<HTMLDivElement | null>(null)
  const { requestProfileEditorClose } = useAppDirty()

  const handleToggle = () => {
    // Closing: route through the editor's own dirty-confirm flow so unsaved
    // edits aren't silently dropped when the user clicks the X (#427). When
    // no editor is registered (clean / wrong row), the call returns false
    // and we fall through to the plain toggle.
    if (isActive && requestProfileEditorClose()) {
      return
    }
    onToggleEditor()
    if (!isActive && rowRef.current) {
      setTimeout(() => {
        rowRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
  }

  const canKill = runningAppIcons.length > 0 && profileState.killControlsEnabled
  const canRelaunch = isRunning && profileState.relaunchControlsEnabled
  const activeProfile = getActiveGameProfile(profileSet)

  return (
    <div
      className={`game-row-container group/row relative flex flex-col ${isActive ? '' : 'gap-2'} transition-opacity duration-300 ${profileMenuOpen ? 'z-40' : 'z-0'} ${isDimmed ? 'opacity-45' : 'opacity-100'}`}
      ref={rowRef}
    >
      <div
        className={`accent-subtle-hover glass-surface flex h-[72px] w-full items-center justify-between rounded-[20px] px-6 ${profileMenuOpen ? 'isolation-auto! z-20' : 'z-0'}`}
      >
        <div className="flex items-center gap-5">
          <GameIcon game={game} isRunning={isRunning} iconUrl={gameIconUrl} />
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h3 className="game-title select-none font-normal text-(--text-primary)">
                {game.name}
              </h3>
            </div>
            <RunningAppsStrip
              runningAppIcons={runningAppIcons}
              cacheInitialized={cacheInitialized}
            />
          </div>
        </div>

        <GameRowActions
          isActive={isActive}
          isLaunching={isLaunching}
          isLaunchBlocked={isLaunchBlocked}
          canKill={canKill}
          canRelaunch={canRelaunch}
          onPrimary={handleLaunch}
          onKill={handleKill}
          onRelaunchMissing={handleRelaunchMissing}
          onToggleEditor={handleToggle}
          profileMenuProps={{
            profileSet,
            activeProfile,
            profileMenuOpen,
            openProfileMenu,
            closeProfileMenu,
            profileMenuRef,
            menuRef,
            triggerRef,
            handleProfileMenuTriggerKeyDown,
            handleProfileMenuKeyDown,
            newProfileFormOpen,
            newProfileName,
            setNewProfileName,
            newProfileInputRef,
            gameName: game.name,
            onProfileSelect: handleProfileSelect,
            onNewProfileSubmit: handleNewProfileSubmit
          }}
        />
      </div>

      <div
        className={`profile-editor-wrapper relative z-0 ${isActive ? 'profile-editor-open' : 'profile-editor-closed'}`}
      >
        <div className="overflow-hidden">
          {isActive && (
            <div className="pb-4">
              <ProfileEditor
                gameKey={game.key}
                activeProfileId={profileSet.activeProfileId}
                onProfilesChanged={loadProfileSet}
                onClose={onCloseEditor}
                onCreateProfile={() =>
                  void handleCreateProfile('New Profile', { trackAsPending: true })
                }
                onProfileCommitted={() => {
                  pendingNewProfileRef.current = null
                }}
                onLaunchRequest={(launcher) => {
                  handleLaunchRequest.current = launcher
                }}
                onLaunchStart={() => onLaunchStart(game.key)}
                onLaunchEnd={(cooldownMs) => onLaunchEnd(game.key, cooldownMs)}
              />
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={profileSwitchConfirm !== null}
        title="Switch Running Profile"
        message={profileSwitchConfirm?.message || ''}
        saveLabel="Switch Profile"
        discardLabel="Keep Current"
        onSave={handleConfirmProfileSwitch}
        onDiscard={() => setProfileSwitchConfirm(null)}
        onCancel={() => setProfileSwitchConfirm(null)}
      />
    </div>
  )
}
