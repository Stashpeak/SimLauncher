// Process tracking gates more than the running indicator: Close Apps, relaunch,
// auto-close and the app swap on a profile switch all need to know what is
// running. With it off, a profile switch saved the choice and silently left
// every app as it was, and two toggles stayed settable while meaning nothing
// (#836). These say so where the controls live: a short line that fits the
// cell, and the full reason on hover, keyboard focus and to Narrator.

export interface RowCopy {
  sublabel: string
  tooltip: string
}

export const TRACKING_ON: RowCopy = {
  sublabel: 'Needed to close and switch apps',
  tooltip:
    'Close Apps, relaunch, auto-close and the app swap on a profile switch all need SimLauncher to see what is running.'
}

export const TRACKING_OFF: RowCopy = {
  sublabel: 'Off: you manage the apps',
  tooltip:
    "SimLauncher is not watching this game. Switching profiles leaves running apps alone, and Close Apps and relaunch are not offered. Launch still starts the profile's apps."
}

// On every control that does nothing without tracking. The tracking toggle sits
// in the section above both of its dependants' sections.
export const TRACKING_REQUIRED: RowCopy = {
  sublabel: 'Needs tracking',
  tooltip:
    'Turn on "Track running indicator for this game" above. Without it SimLauncher cannot see what is running.'
}
