const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/

function getChannel(hex: string, start: number) {
  return parseInt(hex.slice(start, start + 2), 16)
}

function getRelativeLuminanceChannel(channel: number) {
  const normalized = channel / 255

  return normalized <= 0.03928 ? normalized / 12.92 : Math.pow((normalized + 0.055) / 1.055, 2.4)
}

function getRelativeLuminance(hex: string) {
  const r = getRelativeLuminanceChannel(getChannel(hex, 1))
  const g = getRelativeLuminanceChannel(getChannel(hex, 3))
  const b = getRelativeLuminanceChannel(getChannel(hex, 5))

  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function getContrastRatio(lighterLuminance: number, darkerLuminance: number) {
  return (lighterLuminance + 0.05) / (darkerLuminance + 0.05)
}

export function getAccentForeground(hex: string) {
  const accentLuminance = getRelativeLuminance(hex)
  const whiteContrast = getContrastRatio(1, accentLuminance)
  const blackContrast = getContrastRatio(accentLuminance, 0)

  return blackContrast >= whiteContrast ? '#000000' : '#ffffff'
}

export function applyAccentTheme(hex: string) {
  const normalizedHex = hex.trim()

  if (!HEX_COLOR_PATTERN.test(normalizedHex)) {
    return
  }

  const r = getChannel(normalizedHex, 1)
  const g = getChannel(normalizedHex, 3)
  const b = getChannel(normalizedHex, 5)

  document.documentElement.style.setProperty('--accent', normalizedHex)
  document.documentElement.style.setProperty(
    '--accent-foreground',
    getAccentForeground(normalizedHex)
  )
  document.documentElement.style.setProperty('--accent-glow', `rgba(${r}, ${g}, ${b}, 0.24)`)
}
