let isQuitting = false

export function getIsQuitting() {
  return isQuitting
}

export function setIsQuitting(value = true) {
  isQuitting = value
}
