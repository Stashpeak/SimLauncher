import type { ReactNode } from 'react'
import { GamePathMissingBadge } from './GamePathMissingBadge'
import { RunningAppsStrip, type RunningAppIcon } from './RunningAppsStrip'

interface GameRowTitleProps {
  name: string
  pathMissing: boolean
  runningAppIcons: RunningAppIcon[]
  cacheInitialized: boolean
}

/**
 * A game row's title column: the name, and under it the "Game not found"
 * badge followed by the running companion icons.
 *
 * The badge used to sit inline with the name. It is `shrink-0`, so the name
 * was what yielded, down to `RaceRo...` at 175% zoom (#886). The line below
 * already exists, and on a broken row it is usually empty, because the game
 * cannot be launched from it.
 */
export function GameRowTitle({
  name,
  pathMissing,
  runningAppIcons,
  cacheInitialized
}: GameRowTitleProps): ReactNode {
  const strip = (
    <RunningAppsStrip runningAppIcons={runningAppIcons} cacheInitialized={cacheInitialized} />
  )
  // `@container` lets the badge switch to its compact form from this column's
  // width. Size containment drops the column's content width to zero, so it
  // takes its width from `flex-1` instead, here and on the group around it in
  // GameRow; the result is the same width the `min-w-0` chain gave it before.
  return (
    <div className="@container flex min-w-0 flex-1 flex-col gap-0.5">
      {/* Dimmed on a broken row, as a second signal beside the badge. */}
      <h2
        className={`game-title truncate font-normal ${pathMissing ? 'text-(--text-secondary)' : 'text-(--text-primary)'}`}
      >
        {name}
      </h2>
      {/* A healthy row gets the strip unwrapped, exactly as before: a wrapper
          with nothing in it would still take the column's gap and nudge the
          name up. On a broken row the icons wrap below the badge rather than
          run into the action buttons, which they did at 175% zoom with six
          companions running (51px). The row grows for that third line rather
          than clip it (GameRow's min-h). */}
      {pathMissing ? (
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <GamePathMissingBadge />
          {strip}
        </div>
      ) : (
        strip
      )}
    </div>
  )
}
