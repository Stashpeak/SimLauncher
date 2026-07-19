import { useState, type ReactNode, type ReactElement } from 'react'
import { Tooltip } from '../Tooltip'
import { useDismissMenu } from '../../hooks/useDismissMenu'

export interface RunningAppIcon {
  icon: string | null
  name: string
  path: string
  gameKey: string
  warning?: string
  elevated?: boolean
  tracked?: boolean
}

interface RunningAppsStripProps {
  runningAppIcons: RunningAppIcon[]
  cacheInitialized: boolean
}

interface RunningAppIconItemProps {
  app: RunningAppIcon
  isAvailable: boolean
  isFailed: boolean
  cacheInitialized: boolean
  onError: () => void
}

function RunningAppIconItem({
  app,
  isAvailable,
  isFailed,
  cacheInitialized,
  onError
}: RunningAppIconItemProps): ReactNode {
  // Shared right-click / keyboard Dismiss menu (#466, #543) — see useDismissMenu.
  // Arms only when app.warning is set; a normal companion icon stays inert.
  const { isMenuOpen, setTriggerRef, getTriggerProps, menu } = useDismissMenu({
    path: app.path,
    gameKey: app.gameKey,
    name: app.name,
    warning: app.warning,
    tracked: app.tracked
  })

  // Icon still loading (cache not yet populated) and nothing actionable to
  // surface: show a skeleton so the strip doesn't collapse then jump when icons
  // arrive. Once the cache is initialized, a null icon means "no icon found" and
  // falls through to the initial. A warning always renders the button below.
  if (app.icon === null && !isFailed && !cacheInitialized && !app.warning) {
    return <div aria-hidden="true" className="h-4 w-4 skeleton-icon animate-pulse" />
  }

  const initials = app.name
    .replace(/\.exe$/i, '')
    .slice(0, 2)
    .toUpperCase()

  let content: ReactElement<Record<string, unknown>>

  if (app.warning) {
    // A warning icon is actionable (it opens a Dismiss menu), so the trigger is
    // a real focusable <button>: keyboard/Narrator users can reach it, hear that
    // it's actionable (aria-haspopup) and open the menu via Enter/Space or click
    // — not just right-click (WCAG 2.1.1). The inner icon/initial is decorative;
    // the button's aria-label carries the name + warning.
    content = (
      <button
        ref={setTriggerRef}
        type="button"
        aria-label={`${app.name}: ${app.warning}`}
        className="flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-sm border border-(--warning-border)"
        {...getTriggerProps()}
      >
        {isAvailable ? (
          <img
            src={app.icon ?? undefined}
            alt=""
            className="h-4 w-4 object-contain opacity-80"
            onError={onError}
          />
        ) : (
          <span aria-hidden="true" className="text-[6px] font-black">
            {initials}
          </span>
        )}
      </button>
    )
  } else if (isAvailable) {
    content = (
      <img
        ref={setTriggerRef}
        src={app.icon ?? undefined}
        alt=""
        className="h-4 w-4 object-contain opacity-80"
        onError={onError}
      />
    )
  } else {
    content = (
      <div
        ref={setTriggerRef}
        role="img"
        aria-label={app.name}
        className="fallback-initial-icon h-4 w-4 rounded text-[6px] font-black flex items-center justify-center shrink-0"
      >
        {initials}
      </div>
    )
  }

  return (
    <>
      <Tooltip label={app.warning || app.name} disabled={isMenuOpen}>
        {content}
      </Tooltip>

      {menu}
    </>
  )
}

export function RunningAppsStrip({
  runningAppIcons,
  cacheInitialized
}: RunningAppsStripProps): ReactNode {
  // Track image URLs that returned a load error so we can show the text
  // initial fallback without attempting to re-fetch on every render.
  const [failedRunningIcons, setFailedRunningIcons] = useState<Record<string, true>>({})

  if (runningAppIcons.length === 0) return null

  const hasElevated = runningAppIcons.some((app) => app.elevated)

  return (
    <div className="flex items-center gap-1">
      {runningAppIcons.map((app, i) => {
        const isAvailable = !!app.icon && !failedRunningIcons[app.icon]
        const isFailed = failedRunningIcons[app.icon!]

        return (
          <RunningAppIconItem
            key={i}
            app={app}
            isAvailable={isAvailable}
            isFailed={isFailed}
            cacheInitialized={cacheInitialized}
            onError={() => setFailedRunningIcons((current) => ({ ...current, [app.icon!]: true }))}
          />
        )
      })}

      {hasElevated && (
        <Tooltip label="SimLauncher cannot close elevated companion apps.">
          <div
            role="img"
            aria-label="Some companion apps run elevated and cannot be closed by SimLauncher"
            className="flex items-center"
          >
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-(--warning-text) opacity-80 shrink-0 w-3.5 h-3.5"
            >
              <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </div>
        </Tooltip>
      )}
    </div>
  )
}
