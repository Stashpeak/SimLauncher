let isQuitting = false
let rendererDirty = false
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
