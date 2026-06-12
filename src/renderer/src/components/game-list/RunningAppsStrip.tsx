import { useState, type ReactNode, type ReactElement } from 'react'
import { dismissAppIcon } from '../../lib/electron'
import { Tooltip } from '../Tooltip'
import { buildDismissLabel } from '../../lib/contextMenuLabel'
import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  shift,
  useDismiss,
  useFloating,
  useInteractions,
  useRole
} from '@floating-ui/react'

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
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  const { refs, floatingStyles, context } = useFloating({
    open: isMenuOpen,
    onOpenChange: setIsMenuOpen,
    placement: 'bottom-start',
    middleware: [offset(4), flip({ padding: 8 }), shift({ padding: 8 })],
    whileElementsMounted: autoUpdate
  })

  const dismiss = useDismiss(context)
  const role = useRole(context, { role: 'menu' })
  const { getReferenceProps, getFloatingProps } = useInteractions([dismiss, role])

  // Only show the context menu when there is a warning (e.g. process-name
  // mismatch). Apps without warnings get no right-click menu so the native
  // Chromium context menu (inspect element) still works in dev builds.
  const handleContextMenu = (e: React.MouseEvent) => {
    if (app.warning) {
      e.preventDefault()
      setIsMenuOpen(true)
    }
  }

  const handleDismissClick = async (e: React.MouseEvent) => {
    e.stopPropagation()
    // For untracked apps, the icon is unmounted when warning clears;
    // for tracked apps, the icon remains, so close the menu explicitly.
    setIsMenuOpen(false)
    try {
      await dismissAppIcon(app.path, app.gameKey)
    } catch (err) {
      console.error('Failed to dismiss app warning:', err)
    }
  }

  // Accessibility trigger attributes composition
  const triggerProps = getReferenceProps({
    onContextMenu: handleContextMenu,
    'aria-haspopup': app.warning ? ('menu' as const) : undefined,
    'aria-expanded': app.warning ? isMenuOpen : undefined
  })

  const dismissLabel = buildDismissLabel(app.path, {
    tracked: app.tracked,
    name: app.name
  })

  let content: ReactElement<Record<string, unknown>>

  if (isAvailable) {
    content = (
      <img
        ref={refs.setReference}
        src={app.icon ?? undefined}
        alt={app.warning ? `${app.name}: ${app.warning}` : ''}
        className={`h-4 w-4 object-contain opacity-80 ${app.warning ? 'cursor-pointer rounded-sm ring-1 ring-(--warning-text)' : ''}`}
        onError={onError}
        {...triggerProps}
      />
    )
  } else if (app.icon === null && !isFailed && !cacheInitialized) {
    // Icon is still loading (cache not yet populated): show a skeleton so
    // the strip does not collapse and then jump when icons arrive. Once the
    // cache is initialized, a null icon means "no icon found" — fall through
    // to the fallback initial so there's no empty hole.
    return <div aria-hidden="true" className="h-4 w-4 skeleton-icon animate-pulse" />
  } else {
    content = (
      <div
        ref={refs.setReference}
        role="img"
        aria-label={app.warning ? `${app.name}: ${app.warning}` : app.name}
        className={`fallback-initial-icon h-4 w-4 rounded text-[6px] font-black flex items-center justify-center shrink-0 ${app.warning ? 'cursor-pointer ring-1 ring-(--warning-text)' : ''}`}
        {...triggerProps}
      >
        {app.name
          .replace(/\.exe$/i, '')
          .slice(0, 2)
          .toUpperCase()}
      </div>
    )
  }

  return (
    <>
      <Tooltip label={app.warning || app.name} disabled={isMenuOpen}>
        {content}
      </Tooltip>

      {isMenuOpen && (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              ref={refs.setFloating}
              style={floatingStyles}
              {...getFloatingProps()}
              className="z-9999"
            >
              <div className="dropdown-surface overlay-glass rounded-xl p-1 border border-(--glass-border) shadow-(--surface-floating-shadow) animate-fade-slide min-w-[180px]">
                <button
                  type="button"
                  role="menuitem"
                  onClick={handleDismissClick}
                  className="dropdown-item flex w-full cursor-pointer items-center rounded-lg px-2.5 py-1.5 text-left text-xs font-semibold"
                >
                  {dismissLabel}
                </button>
              </div>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      )}
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
