// Boot-theme handshake between main and this preload. Main resolves the
// concrete theme from the PERSISTED settings (synchronously, before the window
// is shown) and passes it here via BrowserWindow webPreferences
// additionalArguments as `--initial-theme=<light|dark>`. This preload applies it
// to the document BEFORE first paint, so a fresh install (default 'system') on a
// light-mode OS does not flash dark while the renderer's async settings read is
// still in flight. ThemeProvider re-applies the loaded value and subscribes to
// live OS-preference changes once that read completes. #735
//
// The prefix string is duplicated in src/main/window.ts (getInitialThemeArg);
// like the IPC channel strings, keep the two in sync by hand.
export const INITIAL_THEME_ARG_PREFIX = '--initial-theme='

/**
 * Pull the resolved boot theme out of the process arguments main injected.
 * Returns null when the argument is absent or malformed so the caller leaves the
 * document untouched (App.css then falls back to its dark default).
 */
export function parseInitialThemeArg(argv: readonly string[]): 'light' | 'dark' | null {
  const arg = argv.find((value) => value.startsWith(INITIAL_THEME_ARG_PREFIX))

  if (!arg) {
    return null
  }

  const theme = arg.slice(INITIAL_THEME_ARG_PREFIX.length)
  return theme === 'light' || theme === 'dark' ? theme : null
}

/**
 * Apply the injected boot theme to the document root before first paint. No-ops
 * when the argument is missing/invalid or the root is unavailable.
 */
export function applyInitialTheme(argv: readonly string[], root: HTMLElement | null): void {
  const theme = parseInitialThemeArg(argv)

  if (theme && root) {
    root.dataset.theme = theme
  }
}
