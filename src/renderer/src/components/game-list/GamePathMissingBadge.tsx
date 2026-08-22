import type { ReactNode } from 'react'
import { Tooltip } from '../Tooltip'

/**
 * The only place the user is told their game moved or was uninstalled, on a row
 * that would otherwise look merely idle (#794).
 *
 * The detail is duplicated into an `sr-only` span rather than living only in
 * the tooltip. A tooltip opens on hover and on focus, but a badge is not a
 * control and must not take tab focus, so keyboard and screen-reader users
 * would never reach the one sentence that says how to fix it. The visible badge
 * stays short because it sits inline with the game title.
 *
 * Whether the path is malformed or simply gone is deliberately not
 * distinguished, matching the launch-time warning: both point at the same fix
 * (#639).
 */
const DETAIL =
  "SimLauncher cannot find this game's files. Update the path in the Games section of Settings."

export function GamePathMissingBadge(): ReactNode {
  return (
    <Tooltip label={DETAIL}>
      <span className="shrink-0 rounded-full border border-(--warning-border) bg-(--warning-surface) px-2 py-0.5 text-xs font-medium text-(--warning-text)">
        Game not found
        <span className="sr-only">. {DETAIL}</span>
      </span>
    </Tooltip>
  )
}
