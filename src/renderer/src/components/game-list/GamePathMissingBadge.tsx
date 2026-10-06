import type { ReactNode } from 'react'
import { Tooltip } from '../Tooltip'
import { WarningTriangleIcon } from '../icons'

/**
 * The only place the user is told their game moved or was uninstalled, on a row
 * that would otherwise look merely idle (#794).
 *
 * The detail is duplicated into an `sr-only` span rather than living only in
 * the tooltip. A tooltip opens on hover and on focus, but a badge is not a
 * control and must not take tab focus, so keyboard and screen-reader users
 * would never reach the one sentence that says how to fix it. The visible badge
 * stays short because it shares the line under the game name with the running
 * companion icons (#886).
 *
 * Where even the short words do not fit (an 800px window at 175% zoom leaves
 * the title column about 18px), the badge drops its pill and shows a bare
 * warning triangle, like the elevated-app warning in the companion strip, and
 * the words move to `sr-only`, so screen readers and the tooltip keep the full
 * text. Even the pill around a 16px triangle was 21px and ran into the buttons. This reads the width of the nearest `@container`, which is the title
 * column in `GameRowTitle`. The "i" mark was considered and not used: it means
 * a tip elsewhere in the app, and a game that cannot be found is a problem.
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
      <span className="flex shrink-0 items-center rounded-full border border-(--warning-border) bg-(--warning-surface) px-2 py-0.5 text-xs font-medium text-(--warning-text) @max-[7.5rem]:border-0 @max-[7.5rem]:bg-transparent @max-[7.5rem]:p-0">
        <span className="@max-[7.5rem]:sr-only">Game not found</span>
        <WarningTriangleIcon width={16} height={16} className="hidden @max-[7.5rem]:block" />
        <span className="sr-only">. {DETAIL}</span>
      </span>
    </Tooltip>
  )
}
