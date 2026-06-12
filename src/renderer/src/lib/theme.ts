const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
export type ThemeMode = 'light' | 'dark' | 'system'

export const DEFAULT_THEME_MODE: ThemeMode = 'dark'

// Module-level cleanup handle for the system-theme media-query listener.
// Only one listener exists at a time because applyThemeMode always cancels
// the previous one before registering a new one.
let themeMediaCleanup: (() => void) | null = null

function getChannel(hex: string, start: number) {
  return parseInt(hex.slice(start, start + 2), 16)
}

function getRelativeLuminanceChannel(channel: number) {
  const normalized = channel / 255
  // WCAG 2.x linearisation formula (IEC 61966-2-1 sRGB transfer function inverse).
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

/**
 * Returns the foreground color (#000 or #fff) that maximises contrast against
 * the given accent hex color, using the WCAG 2.x relative-luminance formula.
 * Ties break in favour of black (higher perceived contrast for most users).
 */
export function getAccentForeground(hex: string): '#000000' | '#ffffff' {
  const accentLuminance = getRelativeLuminance(hex)
  const whiteContrast = getContrastRatio(1, accentLuminance)
  const blackContrast = getContrastRatio(accentLuminance, 0)

  return blackContrast >= whiteContrast ? '#000000' : '#ffffff'
}

/**
 * Writes the accent color and its derived tokens to the document root as CSS
 * custom properties. Silently no-ops for invalid hex strings so callers can
 * pass raw user input without pre-validation.
 *
 * Three tokens are set: --accent (the raw hex), --accent-foreground (the
 * accessible foreground from getAccentForeground), and --accent-glow (an rgba
 * that composes the opacity from --accent-glow-opacity defined in the stylesheet).
 */
export function applyAccentTheme(hex: string): void {
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
  document.documentElement.style.setProperty(
    '--accent-glow',
    `rgba(${r}, ${g}, ${b}, var(--accent-glow-opacity))`
  )
}

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system' ? value : DEFAULT_THEME_MODE
}

/**
 * Applies the theme mode to the document and subscribes to system preference
 * changes when mode is 'system'.
 *
 * Calling this again with a different mode correctly cancels the previous
 * media-query listener before installing a new one — safe to call on every
 * settings change. The resolved theme is reflected on
 * `document.documentElement.dataset.theme` ('light' | 'dark').
 */
export function applyThemeMode(mode: ThemeMode): void {
  themeMediaCleanup?.()
  themeMediaCleanup = null

  const applyResolvedTheme = (theme: 'light' | 'dark') => {
    document.documentElement.dataset.theme = theme
  }

  if (mode !== 'system') {
    applyResolvedTheme(mode)
    return
  }

  const media = window.matchMedia('(prefers-color-scheme: light)')
  const applySystemTheme = () => applyResolvedTheme(media.matches ? 'light' : 'dark')

  applySystemTheme()

  media.addEventListener('change', applySystemTheme)
  themeMediaCleanup = () => media.removeEventListener('change', applySystemTheme)
}
