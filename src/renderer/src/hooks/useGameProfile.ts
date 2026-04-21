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

const getProfileState = (profileSet: GameProfileSet): ProfileState => {
  const profile = getActiveGameProfile(profileSet)

  return {
    killControlsEnabled: profile.killControlsEnabled === true,
    relaunchControlsEnabled: profile.relaunchControlsEnabled === true
  }
}

export function useGameProfile(gameKey: string, isActive: boolean, activeProfileId?: string) {
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
    window.addEventListener('focus', load)

    return () => {
      mounted = false
      window.removeEventListener('focus', load)
    }
  }, [activeProfileId, applyProfileSet, isActive, readProfileSet])

  const getProfileRuntimeConfig = async (): Promise<GameProfileSet> => readProfileSet()

  const saveProfileSet = async (nextProfileSet: GameProfileSet) => {
    await saveProfile(gameKey, nextProfileSet)
    applyProfileSet(nextProfileSet)
  }

  return { profileSet, profileState, loadProfileSet, getProfileRuntimeConfig, saveProfileSet }
}
