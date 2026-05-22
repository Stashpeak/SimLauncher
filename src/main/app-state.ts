let isQuitting = false
let rendererDirty = false
let pendingMinimizeToTray: boolean | null = null

export function getIsQuitting() {
  return isQuitting
}

export function setIsQuitting(value = true) {
  isQuitting = value
}

export function getRendererDirty() {
  return rendererDirty
}

export function setRendererDirty(value: boolean) {
  rendererDirty = value
}

export function getPendingMinimizeToTray() {
  return pendingMinimizeToTray
}

export function setPendingMinimizeToTray(value: boolean | null) {
  pendingMinimizeToTray = value
}
