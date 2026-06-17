// Shared in-process flags that coordinate the window close / quit / tray flow.
// isQuitting can change from both IPC handlers (renderer thread) and main-thread
// event listeners (before-quit, tray quit); the other two are written only from
// IPC handlers. So none of them should be read across an async gap between an
// IPC call and its response — capture synchronously at the start of a handler.
let isQuitting = false
let rendererDirty = false
// null  = no settings edit in flight; use persisted store values.
// true/false = renderer has an unsaved tray-preference change; honour this
//              value for close decisions so the pending edit "takes effect"
//              immediately without requiring a save first.
let pendingMinimizeToTray: boolean | null = null

export function getIsQuitting(): boolean {
  return isQuitting
}

export function setIsQuitting(value = true): void {
  isQuitting = value
}

export function getRendererDirty(): boolean {
  return rendererDirty
}

export function setRendererDirty(value: boolean): void {
  rendererDirty = value
}

export function getPendingMinimizeToTray(): boolean | null {
  return pendingMinimizeToTray
}

export function setPendingMinimizeToTray(value: boolean | null): void {
  pendingMinimizeToTray = value
}
