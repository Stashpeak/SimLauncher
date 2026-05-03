import { useState } from 'react'

export interface RunningAppIcon {
  icon: string | null
  name: string
  warning?: string
}

interface RunningAppsStripProps {
  runningAppIcons: RunningAppIcon[]
  cacheInitialized: boolean
}

export function RunningAppsStrip({ runningAppIcons, cacheInitialized }: RunningAppsStripProps) {
  const [failedRunningIcons, setFailedRunningIcons] = useState<Record<string, true>>({})

  if (runningAppIcons.length === 0) return null

  const hasWarnings = runningAppIcons.some((app) => app.warning)

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-1">
        {runningAppIcons.map((app, i) => {
          const isAvailable = !!app.icon && !failedRunningIcons[app.icon]
          const isFailed = failedRunningIcons[app.icon!]

          if (isAvailable) {
            return (
              <img
                key={i}
                src={app.icon ?? undefined}
                alt=""
                title={app.warning || app.name}
                className={`h-4 w-4 object-contain opacity-80 ${app.warning ? 'rounded-sm ring-1 ring-(--warning-text)' : ''}`}
                onError={() =>
                  setFailedRunningIcons((current) => ({ ...current, [app.icon!]: true }))
                }
              />
            )
          }

          if (app.icon === null && !isFailed && !cacheInitialized) {
            return <div key={i} className="h-4 w-4 skeleton-icon animate-pulse" />
          }

          return (
            <div
              key={i}
              className={`fallback-initial-icon h-4 w-4 rounded text-[6px] font-black flex items-center justify-center shrink-0 ${app.warning ? 'ring-1 ring-(--warning-text)' : ''}`}
              title={app.warning || app.name}
            >
              {app.name
                .replace(/\.exe$/i, '')
                .slice(0, 2)
                .toUpperCase()}
            </div>
          )
        })}
      </div>

      {hasWarnings && (
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-(--warning-text)">
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="shrink-0"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <span>SimLauncher cannot track or close elevated companion apps.</span>
        </div>
      )}
    </div>
  )
}
