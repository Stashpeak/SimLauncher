// Process tracking gates more than the running indicator: Close Apps, relaunch,
// auto-close and the app swap on a profile switch all need to know what is
// running. With it off, a profile switch saved the choice and silently left
// every app as it was, and two toggles stayed settable while meaning nothing
// (#836). These strings say so where the controls live.

export const TRACKING_ON_SUBLABEL = 'Needed to close, relaunch and switch apps'

export const TRACKING_OFF_SUBLABEL = 'Off: switching profiles leaves apps running'

// On every control that does nothing without tracking. The tracking toggle sits
// in the section above both of its dependants' sections.
export const TRACKING_REQUIRED_SUBLABEL = 'Needs the running indicator above'
