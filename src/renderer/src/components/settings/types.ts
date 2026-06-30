export type UpdateInfo = { version: string } | null

export type UpdateStatus = 'up-to-date' | 'downloaded' | 'error' | 'offline' | null

// Payload from the 'update-error' channel. `isNetworkError` distinguishes a
// connectivity problem (offline rig) from a real updater fault.
export type UpdateErrorInfo = { message?: string; isNetworkError?: boolean }

// The collapsible Settings sections, in render order. Used to deep-link a
// navigation straight into one section (e.g. the "Configure Games" CTA, or
// onboarding) so it opens expanded and scrolled into view (#642 / #583).
export type SettingsSectionKey = 'about' | 'appearance' | 'behavior' | 'config' | 'games' | 'apps'
