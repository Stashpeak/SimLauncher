const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/
export type ThemeMode = 'light' | 'dark' | 'system'

export const DEFAULT_THEME_MODE: ThemeMode = 'system'

// Module-level cleanup handle for the system-theme media-query listener.
// Only one listener exists at a time because applyThemeMode always cancels
// the previous one before registering a new one.
let themeMediaCleanup: (() => void) | null = null

// The live accent hex, remembered so the derived --accent-text token can be
// recomputed whenever EITHER the accent or the resolved theme changes (the
// readable variant depends on both). Mirrors the App.css default brand teal.
let currentAccentHex = '#008c99'

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

// Representative background surfaces the accent-colored TEXT labels (section
// headings, update pill, launch-order badge) sit on, used to derive a readable
// --accent-text. Dark = a panel/glass surface over the app gradient; light =
// the near-white app background. Chosen toward the lighter end of each so the
// derived text still clears AA on the lightest surface a label can land on.
const DARK_TEXT_BG_REF = '#322d3a'
const LIGHT_TEXT_BG_REF = '#f4f4f8'
// Slightly above the 4.5:1 AA floor for normal text, for margin across surfaces.
const ACCENT_TEXT_TARGET_CONTRAST = 4.6
// Accent fraction blended into the reference surface to model the accent-TINTED
// backgrounds the text actually sits on (launch-order badge ~15% over glass,
// update pill ~12-18%; in light theme the glass itself is accent-tinted). The
// tint pulls the background toward the text's own hue and lowers contrast below
// a plain surface, so the readable variant must be derived against it.
const TEXT_BG_TINT = 0.2

function clampChannel(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

function channelToHex(value: number) {
  return clampChannel(value).toString(16).padStart(2, '0')
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${channelToHex(r)}${channelToHex(g)}${channelToHex(b)}`
}

// Alpha-composite fgHex over bgHex at the given alpha (src-over). Used to model
// an accent-tinted surface as a flat reference color for contrast derivation.
function compositeOver(fgHex: string, bgHex: string, alpha: number): string {
  return rgbToHex(
    getChannel(fgHex, 1) * alpha + getChannel(bgHex, 1) * (1 - alpha),
    getChannel(fgHex, 3) * alpha + getChannel(bgHex, 3) * (1 - alpha),
    getChannel(fgHex, 5) * alpha + getChannel(bgHex, 5) * (1 - alpha)
  )
}

function contrastBetween(hexA: string, hexB: string) {
  const a = getRelativeLuminance(hexA)
  const b = getRelativeLuminance(hexB)
  return a >= b ? getContrastRatio(a, b) : getContrastRatio(b, a)
}

/**
 * Derives a readable text color from the accent by blending it toward `toward`
 * (white on dark surfaces, black on light) just far enough to meet
 * ACCENT_TEXT_TARGET_CONTRAST against bgHex. Returns the accent unchanged when
 * it already passes, and `toward` as the guaranteed-legible fallback. Keeps the
 * accent's hue while making it AA-legible as text, including for custom accents
 * that fail at full saturation.
 */
function deriveAccentText(accentHex: string, bgHex: string, toward: string): string {
  const ar = getChannel(accentHex, 1)
  const ag = getChannel(accentHex, 3)
  const ab = getChannel(accentHex, 5)
  const tr = getChannel(toward, 1)
  const tg = getChannel(toward, 3)
  const tb = getChannel(toward, 5)

  for (let t = 0; t <= 1.0001; t += 0.05) {
    const candidate = rgbToHex(ar + (tr - ar) * t, ag + (tg - ag) * t, ab + (tb - ab) * t)
    if (contrastBetween(candidate, bgHex) >= ACCENT_TEXT_TARGET_CONTRAST) {
      return candidate
    }
  }

  return toward
}

/**
 * (Re)computes --accent-text from the live accent and the resolved theme.
 * Invoked whenever the accent changes (applyAccentTheme) or the theme flips
 * (applyThemeMode), since the readable variant depends on both.
 */
function applyAccentTextToken(): void {
  const isLight = document.documentElement.dataset.theme === 'light'
  // Derive against the worst case: the accent composited over the plain surface,
  // modeling the accent-tinted badge/pill backgrounds. Plain-surface text (the
  // section headings) then clears AA with extra margin.
  const tintedRef = compositeOver(
    currentAccentHex,
    isLight ? LIGHT_TEXT_BG_REF : DARK_TEXT_BG_REF,
    TEXT_BG_TINT
  )
  const accentText = deriveAccentText(currentAccentHex, tintedRef, isLight ? '#000000' : '#ffffff')
  document.documentElement.style.setProperty('--accent-text', accentText)
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
 * Four tokens are set: --accent (the raw hex), --accent-foreground (the
 * accessible foreground from getAccentForeground), --accent-glow (an rgba that
 * composes the opacity from --accent-glow-opacity defined in the stylesheet),
 * and --accent-text (a contrast-tuned variant for accent-colored text, derived
 * for the current theme so it stays AA-legible even for custom accents).
 */
export function applyAccentTheme(hex: string): void {
  const normalizedHex = hex.trim()

  if (!HEX_COLOR_PATTERN.test(normalizedHex)) {
    return
  }

  const r = getChannel(normalizedHex, 1)
  const g = getChannel(normalizedHex, 3)
  const b = getChannel(normalizedHex, 5)

  currentAccentHex = normalizedHex
  document.documentElement.style.setProperty('--accent', normalizedHex)
  document.documentElement.style.setProperty(
    '--accent-foreground',
    getAccentForeground(normalizedHex)
  )
  document.documentElement.style.setProperty(
    '--accent-glow',
    `rgba(${r}, ${g}, ${b}, var(--accent-glow-opacity))`
  )
  applyAccentTextToken()
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
    // The readable --accent-text depends on the resolved theme, so recompute it
    // whenever the theme changes (including live system-preference changes).
    applyAccentTextToken()
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
