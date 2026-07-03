import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
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
import { formatSkippedLaunchEntries } from '../../lib/skippedLaunchEntries'
import { useGameProfile } from '../../hooks/useGameProfile'
import { useProfileMenu } from '../../hooks/useProfileMenu'
import { GameIcon } from './GameIcon'
import { RunningAppsStrip, type RunningAppIcon } from './RunningAppsStrip'
import { GameRowActions } from './GameRowActions'
import { ConfirmDialog } from '../ConfirmDialog'
import { useAppDirty } from '../../contexts/AppDirtyContext'

// How long to block a second launch attempt after apps have been started.
// Gives processes time to register before another launch would duplicate them.
// Cooldown is skipped (0 ms) when no apps were actually launched.
const POST_LAUNCH_BLOCK_MS = 10000

export function GameRow({
  game,
  isActive,
  isRunning,
  isGameRunning,
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
  // Aggregate: any tracked app under this game's key is running (game exe OR a
  // companion). Drives sorting, dimming, relaunch-missing and the switch
  // confirm — all of which mean "this profile has something running".
  isRunning: boolean
  // Narrow: the game's OWN executable is running. Drives only the green status
  // dot, whose tooltip/label assert the game itself is running (#587).
  isGameRunning: boolean
  runningAppIcons: RunningAppIcon[]
  gameIconUrl?: string
  isDimmed: boolean
  isLaunching: boolean
  isLaunchBlocked: boolean
  onLaunchStart: (gameKey: string) => void
  // `primaryLaunch` marks a fresh game launch (vs a profile switch / relaunch-
  // missing) so the launch-block only speaks the "now running" cue after a real
  // launch.
  onLaunchEnd: (gameKey: string, cooldownMs?: number, options?: { primaryLaunch?: boolean }) => void
  onRunningStateRefresh: () => Promise<void>
  onToggleEditor: () => void
  // Explicit close for this row's editor (key-guarded functional update) so the
  // async discard path can close without a stale toggle reopening/closing the
  // wrong row if the user opens another editor mid-await (#453 Codex P2).
  onCloseEditor: () => void
  cacheInitialized: boolean
}): ReactNode {
  const { notify, announce } = useNotify()
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
  // state) so the cleanup reads the latest value synchronously and a deliberate
  // commit can clear it before the close fires.
  const pendingNewProfileRef = useRef<{
    newProfileId: string
    previousActiveProfileId: string
  } | null>(null)
  // Mirror of isActive readable from async tails (handleCreateProfile) where the
  // captured prop would be stale.
  const isActiveRef = useRef(isActive)
  useEffect(() => {
    isActiveRef.current = isActive
  }, [isActive])

  // Removes a still-pending "+" profile and restores the previously-active one.
  // Clears the ref up front so the two callers (the close effect and the
  // post-save guard) can't double-run, and reads the store fresh so it reflects
  // a just-completed create.
  const discardPendingProfile = useCallback(async () => {
    const pending = pendingNewProfileRef.current
    if (!pending) {
      return
    }
    pendingNewProfileRef.current = null
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
  }, [getProfileRuntimeConfig, saveProfileSet])

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
    if (options?.trackAsPending) {
      pendingNewProfileRef.current = { newProfileId: newProfile.id, previousActiveProfileId }
      // If the editor was closed while this save was in flight, the close effect
      // already ran while the ref was still null and won't re-fire, so discard
      // the freshly-persisted profile now that the store is consistent (#453).
      if (!isActiveRef.current) {
        void discardPendingProfile()
      }
    } else {
      pendingNewProfileRef.current = null
    }
    notify(`Created profile ${newProfile.name}`, 'success')
  }

  // When this row's editor closes for ANY reason -- explicit close / discard, or
  // being collapsed because another row's (or Settings') editor was opened --
  // discard a still-pending "+" profile. Living in an isActive effect rather
  // than the close handler so it also catches the close-by-opening-another-row
  // path, which never routes through onClose (#453).
  useEffect(() => {
    if (!isActive) {
      void discardPendingProfile()
    }
  }, [isActive, discardPendingProfile])

  // Safety net for unmount paths that never flip isActive — e.g. the
  // refreshKey remount after a config import. Fire-and-forget through a
  // latest-value ref so the empty-deps cleanup can't go stale; double-runs
  // with the discard pipeline (#478) are no-ops because discardPendingProfile
  // clears its ref up front.
  const discardPendingProfileRef = useRef(discardPendingProfile)
  useEffect(() => {
    discardPendingProfileRef.current = discardPendingProfile
  }, [discardPendingProfile])
  useEffect(() => {
    return () => {
      void discardPendingProfileRef.current()
    }
  }, [])

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
          if (result.skipped && result.skipped.length > 0) {
            switchWarnings.push(
              formatSkippedLaunchEntries(result.skipped, { gameKey: game.key, gameName: game.name })
            )
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

  // When the profile editor is open and its own launch button is pressed, the
  // editor registers its launcher here so the GameRow's launch path (keyboard
  // shortcut, row button) delegates to the same flow — ensuring the editor's
  // dirty-check confirm fires before the launch instead of being bypassed.
  const handleLaunchRequest = useRef<(() => void) | null>(null)

  const handleLaunch = async () => {
    if (isActive && handleLaunchRequest.current) {
      handleLaunchRequest.current()
      return
    }

    if (isLaunchBlocked) {
      return
    }

    // Capture BEFORE launching: this is a fresh game start only if the GAME EXE
    // wasn't already running. Use isGameRunning, not the aggregate isRunning — if
    // only a companion was up (game not running), launching the game IS a primary
    // launch and the "now running" cue should fire; the aggregate would suppress
    // it (#587).
    const wasRunning = isGameRunning
    let cooldownMs = 0

    try {
      onLaunchStart(game.key)
      // Polite SR cue that a launch has begun. The button's spinner + aria-busy
      // are visual/verbosity-dependent; this live-region announcement is the
      // reliable spoken "launch started" feedback, paired with the existing
      // "X is now running" settle cue (#612).
      announce(`Launching ${game.name}`)
      const result = await launchProfile(game.key)
      if (!result.success) {
        cooldownMs = result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS
        notify(result.error || 'Failed to launch profile', 'error')
        return
      }

      cooldownMs = result.launchedCount === 0 ? 0 : POST_LAUNCH_BLOCK_MS
      // A moved/deleted exe is filtered out before spawn but must not read as
      // a plain success (#639) — surface it as a warning naming what was
      // skipped, alongside any elevated-launch warning.
      const launchWarnings: string[] = []
      if (result.skipped && result.skipped.length > 0) {
        launchWarnings.push(
          formatSkippedLaunchEntries(result.skipped, { gameKey: game.key, gameName: game.name })
        )
      }
      if (result.warning) {
        launchWarnings.push(result.warning)
      }
      const launchWarning = launchWarnings.length > 0 ? launchWarnings.join(' ') : undefined
      notify(
        launchWarning || result.message || `Launching ${game.name}`,
        launchWarning ? 'warn' : 'success',
        launchWarning ? 5000 : undefined
      )
    } catch (err) {
      notify('Failed to launch profile', 'error')
      console.error(err)
    } finally {
      onLaunchEnd(game.key, cooldownMs, { primaryLaunch: !wasRunning })
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
      const relaunchWarnings: string[] = []
      if (result.skipped && result.skipped.length > 0) {
        relaunchWarnings.push(
          formatSkippedLaunchEntries(result.skipped, { gameKey: game.key, gameName: game.name })
        )
      }
      if (result.warning) {
        relaunchWarnings.push(result.warning)
      }
      const relaunchWarning = relaunchWarnings.length > 0 ? relaunchWarnings.join(' ') : undefined
      notify(
        relaunchWarning || result.message || 'Relaunching missing apps',
        relaunchWarning ? 'warn' : 'success',
        relaunchWarning ? 5000 : undefined
      )
    } catch (err) {
      notify('Failed to relaunch missing apps', 'error')
      console.error(err)
    } finally {
      onLaunchEnd(game.key, cooldownMs)
    }
  }

  // Stable, human-readable id for the editor panel — used by aria-controls on
  // the toggle button. Prefer game.key (always present in production) and fall
  // back to the React-generated id only as a safety net in tests / edge cases.
  const reactId = useId()
  const editorId = `profile-editor-${game.key || reactId}`

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
      // Defer one tick so the editor panel has started its CSS expand
      // transition before scrollIntoView measures the row's new height.
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
      role="listitem"
      // Name the list item so Narrator announces the game (e.g. "Assetto Corsa,
      // 3 of 7") instead of synthesizing a bare list marker ("bullet") in front
      // of each focused control in the row (#612). Keeps the list semantics.
      aria-label={game.name}
      className={`game-row-container group/row relative flex flex-col ${isActive ? '' : 'gap-2'} transition-opacity duration-300 ${profileMenuOpen ? 'z-40' : 'z-0'} ${isDimmed ? 'opacity-45' : 'opacity-100'}`}
      ref={rowRef}
    >
      <div
        className={`accent-subtle-hover glass-surface flex h-[72px] w-full items-center justify-between rounded-[20px] px-6 ${profileMenuOpen ? 'isolation-auto! z-20' : 'z-0'}`}
      >
        <div className="flex items-center gap-5">
          <GameIcon game={game} isRunning={isGameRunning} iconUrl={gameIconUrl} />
          <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <h2 className="game-title font-normal text-(--text-primary)">{game.name}</h2>
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
          gameName={game.name}
          editorId={editorId}
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
        id={editorId}
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
                onDiscarded={discardPendingProfile}
                onLaunchRequest={(launcher) => {
                  handleLaunchRequest.current = launcher
                }}
                onLaunchStart={() => {
                  announce(`Launching ${game.name}`)
                  onLaunchStart(game.key)
                }}
                // primaryLaunch only when the game EXE wasn't already running
                // (isGameRunning, not the aggregate), so the "now running" cue
                // isn't spoken for a launch that merely (re)starts companion apps
                // for an already-running game — but still fires when only a
                // companion was up (#587).
                onLaunchEnd={(cooldownMs) =>
                  onLaunchEnd(game.key, cooldownMs, { primaryLaunch: !isGameRunning })
                }
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
