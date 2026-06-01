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

let focusListenerActive = false
let focusDebounceTimer: ReturnType<typeof setTimeout> | undefined

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
    window.addEventListener(PROFILE_FOCUS_EVENT, load)

    return () => {
      mounted = false
      window.removeEventListener(PROFILE_FOCUS_EVENT, load)
    }
  }, [activeProfileId, applyProfileSet, isActive, readProfileSet])

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
