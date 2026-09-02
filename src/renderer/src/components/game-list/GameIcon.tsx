import { useEffect, useState, type ReactNode } from 'react'
import type { Game } from '../../lib/config'
import { Tooltip } from '../Tooltip'
import { useDismissMenu } from '../../hooks/useDismissMenu'

interface GameIconProps {
  game: Game
  isRunning: boolean
  iconUrl?: string
  // When the green dot is driven by a warning entry rather than a confirmed live
  // process, `warning` carries its text and `dismissPath` the path to dismiss.
  // The dot then offers a right-click / keyboard Dismiss menu; otherwise the
  // icon is inert (a normal running dot clears itself when the process exits).
  // `tracked` distinguishes the two warning kinds so the menu labels itself
  // correctly (mirrors the companion strip): a stale process-name-mismatch stub
  // that self-exited (#737) is untracked → "Dismiss Icon"; a still-running
  // kill-failed game exe is tracked → "Dismiss Warning".
  warning?: string
  dismissPath?: string
  tracked?: boolean
}

const STATUS_DOT_BASE_CLASS = 'status-dot absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full'
const STATUS_DOT_CLASS = `${STATUS_DOT_BASE_CLASS} bg-(--status-running) shadow-[0_0_8px_var(--status-running)]`
// "We cannot tell", not "running" (#737). A mismatch-warning entry is surfaced
// only when the launched exe is ABSENT from the tasklist (running.ts), and at
// that point both readings are live at once: the game exited, or it handed off
// to a child process under a name nothing here can see. Green asserts the
// second; nothing asserts the first; neither is known. `--status-warning` is
// the amber already used for the strip's elevated-companion triangle, and it
// aliases `--warning-text`, so it follows the theme without a per-theme entry
// (same as --status-danger / --status-success).
// `status-dot-unknown` is styled in App.css as a hollow RING, in every theme
// rather than only in Windows High Contrast. Colour alone fails WCAG 1.4.1, and
// green-versus-amber is the pair red-green colour vision deficiency compresses
// hardest, so at 12px the hue difference was a discrimination task rather than a
// glance. High Contrast keeps its own copy of the rule because the OS overrides
// author colours there (Codex P2 on #829); this is the general case (#737).
//
// The fill deliberately does NOT appear here: App.css owns it, because the ring
// needs `background: var(--bg-gradient)` (the page showing through) and a
// Tailwind `bg-(…)` utility would set `background-color`, which cannot take a
// gradient — and would race the CSS rule on equal specificity. The amber is
// still carried, by the border and the glow.
const STATUS_DOT_UNKNOWN_CLASS = `${STATUS_DOT_BASE_CLASS} status-dot-unknown shadow-[0_0_8px_var(--status-warning)]`

export function GameIcon({
  game,
  isRunning,
  iconUrl,
  warning,
  dismissPath,
  tracked
}: GameIconProps): ReactNode {
  const [iconLoadFailed, setIconLoadFailed] = useState(false)

  // Reset the error flag when the URL changes so a newly-configured icon gets
  // a fresh load attempt rather than staying permanently in the fallback state.
  useEffect(() => {
    setIconLoadFailed(false)
  }, [iconUrl])

  // Called unconditionally (rules of hooks). The menu only arms when `warning`
  // is set, so a normally-running or idle icon stays inert and keeps the native
  // context menu (dev inspect).
  const dismissMenu = useDismissMenu({
    path: dismissPath ?? '',
    gameKey: game.key,
    name: game.name,
    warning,
    tracked
  })
  const isDismissible = isRunning && !!warning && !!dismissPath

  const iconContent =
    iconUrl && !iconLoadFailed ? (
      <img
        src={iconUrl}
        alt={game.name}
        className="game-icon-image h-12 w-12 object-contain animate-fade-slide"
        onError={() => setIconLoadFailed(true)}
      />
    ) : !iconLoadFailed ? (
      // No URL yet (icon still loading from Settings): show a pulsing skeleton
      // placeholder so the row layout is stable during load.
      <div aria-hidden="true" className="h-12 w-12 skeleton-icon animate-pulse" />
    ) : null /* iconLoadFailed: render nothing — the 48px slot looks odd with a
                truncated initial, so an empty slot is less distracting. */

  // Stuck-dot case (#737): the dot reflects a mismatch warning, not a confirmed
  // live process. The whole icon becomes a focusable trigger that opens a
  // Dismiss menu on right-click / Enter / Space (mirrors the running-strip
  // warning affordance, #543). The warning text itself tells the user to
  // right-click to dismiss, so it doubles as the tooltip and the accessible name.
  if (isDismissible) {
    return (
      <>
        <Tooltip label={warning} disabled={dismissMenu.isMenuOpen}>
          <button
            ref={dismissMenu.setTriggerRef}
            type="button"
            aria-label={`${game.name}: ${warning}`}
            className="relative flex h-12 w-12 shrink-0 cursor-pointer items-center justify-center rounded-xl"
            {...dismissMenu.getTriggerProps()}
          >
            {iconContent}
            {/* Only the UNTRACKED warning is the unknown state. This branch also
                serves a tracked one: a game exe that failed to close and is
                still running, surfaced from `unclosedProcesses` only while its
                image IS in the tasklist. That one genuinely is running, so
                amber would downgrade a fact to a guess. */}
            <span
              aria-hidden="true"
              className={tracked ? STATUS_DOT_CLASS : STATUS_DOT_UNKNOWN_CLASS}
            />
          </button>
        </Tooltip>
        {dismissMenu.menu}
      </>
    )
  }

  return (
    <div className="relative flex h-12 w-12 shrink-0 items-center justify-center">
      {iconContent}
      {isRunning && (
        <Tooltip label="Running">
          <div className={STATUS_DOT_CLASS}>
            <span className="sr-only">{game.name} is running</span>
          </div>
        </Tooltip>
      )}
    </div>
  )
}
