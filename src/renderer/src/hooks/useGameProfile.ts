import { useCallback, useEffect, useState } from 'react'
import {
  getActiveGameProfile,
  normalizeGameProfileSet,
  type GameProfileSet,
  type Profiles
} from '../lib/config'
import { getProfiles, saveProfile } from '../lib/store'

type ProfileState = {
  killControlsEnabled: boolean
  relaunchControlsEnabled: boolean
}

const FOCUS_DEBOUNCE_MS = 300
const PROFILE_FOCUS_EVENT = 'simlauncher:profile-focus-reload'

// Module-level singleton: the OS 'focus' listener is registered once for the
// entire renderer lifetime and debounced, so each focus regain produces exactly
// one PROFILE_FOCUS_EVENT dispatch. NOTE: this does NOT dedupe store reads —
// every mounted useGameProfile registers its own PROFILE_FOCUS_EVENT handler, so
// the store is read once per mounted game row per focus regain.
let focusListenerActive = false
let focusDebounceTimer: ReturnType<typeof setTimeout> | undefined

// Debounce is needed because the OS can fire the window focus event multiple
// times in rapid succession (e.g. Windows switching away and back).
function ensureFocusListener() {
  if (focusListenerActive) {
    return
  }

  focusListenerActive = true
  window.addEventListener('focus', () => {
    clearTimeout(focusDebounceTimer)
    focusDebounceTimer = setTimeout(() => {
      window.dispatchEvent(new Event(PROFILE_FOCUS_EVENT))
    }, FOCUS_DEBOUNCE_MS)
  })
}

const getProfileState = (profileSet: GameProfileSet): ProfileState => {
  const profile = getActiveGameProfile(profileSet)

  return {
    killControlsEnabled: profile.killControlsEnabled === true,
    relaunchControlsEnabled: profile.relaunchControlsEnabled === true
  }
}

export interface UseGameProfileResult {
  profileSet: GameProfileSet
  profileState: ProfileState
  loadProfileSet: () => Promise<GameProfileSet>
  getProfileRuntimeConfig: () => Promise<GameProfileSet>
  saveProfileSet: (nextProfileSet: GameProfileSet) => Promise<void>
}

export function useGameProfile(
  gameKey: string,
  isActive: boolean,
  activeProfileId?: string
): UseGameProfileResult {
  const [profileSet, setProfileSet] = useState<GameProfileSet>(() =>
    normalizeGameProfileSet(undefined)
  )
  const [profileState, setProfileState] = useState<ProfileState>({
    killControlsEnabled: false,
    relaunchControlsEnabled: false
  })

  const readProfileSet = useCallback(async () => {
    const profiles = await getProfiles()
    return normalizeGameProfileSet(profiles[gameKey] as Profiles[string] | undefined)
  }, [gameKey])

  const applyProfileSet = useCallback((nextProfileSet: GameProfileSet) => {
    setProfileSet(nextProfileSet)
    setProfileState(getProfileState(nextProfileSet))
  }, [])

  const loadProfileSet = useCallback(async () => {
    const nextProfileSet = await readProfileSet()
    applyProfileSet(nextProfileSet)
    return nextProfileSet
  }, [applyProfileSet, readProfileSet])

  useEffect(() => {
    let mounted = true

    async function load() {
      const nextProfileSet = await readProfileSet()

      if (!mounted) {
        return
      }

      applyProfileSet(nextProfileSet)
    }

    load()
    ensureFocusListener()
    // Re-read the store whenever the app regains focus in case an external
    // tool (or another SimLauncher window) modified the profile on disk.
    window.addEventListener(PROFILE_FOCUS_EVENT, load)

    return () => {
      mounted = false
      window.removeEventListener(PROFILE_FOCUS_EVENT, load)
    }
    // activeProfileId and isActive are included so that switching the active
    // profile or deactivating the game row re-triggers the load.
  }, [activeProfileId, applyProfileSet, isActive, readProfileSet])

  // Reads the store fresh at call time rather than returning the cached React
  // state, so callers (launch path) see any changes made after the last render.
  const getProfileRuntimeConfig = useCallback(
    async (): Promise<GameProfileSet> => readProfileSet(),
    [readProfileSet]
  )

  const saveProfileSet = useCallback(
    async (nextProfileSet: GameProfileSet) => {
      await saveProfile(gameKey, nextProfileSet)
      applyProfileSet(nextProfileSet)
    },
    [applyProfileSet, gameKey]
  )

  return { profileSet, profileState, loadProfileSet, getProfileRuntimeConfig, saveProfileSet }
}
