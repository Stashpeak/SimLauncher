import { getActiveGameProfile, type GameProfileSet } from './config'

export type ProfileState = {
  killControlsEnabled: boolean
  relaunchControlsEnabled: boolean
}

// Default ON: managing companion apps is the core use case, so the Close Apps
// and Relaunch controls are surfaced unless a profile explicitly opts out with
// `false`. Profiles from before these toggles existed (field absent) therefore
// get the controls too; users can still disable them per-profile (#590).
export function getProfileState(profileSet: GameProfileSet): ProfileState {
  const profile = getActiveGameProfile(profileSet)

  return {
    killControlsEnabled: profile.killControlsEnabled !== false,
    relaunchControlsEnabled: profile.relaunchControlsEnabled !== false
  }
}
