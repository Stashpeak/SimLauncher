export type UpdateInfo = { version: string } | null

export type UpdateStatus = 'up-to-date' | 'downloaded' | 'error' | 'offline' | null

// Payload from the 'update-error' channel. `isNetworkError` distinguishes a
// connectivity problem (offline rig) from a real updater fault.
export type UpdateErrorInfo = { message?: string; isNetworkError?: boolean }
