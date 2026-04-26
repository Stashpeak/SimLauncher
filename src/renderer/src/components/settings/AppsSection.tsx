import { MAX_CUSTOM_SLOTS, type Utility } from '../../lib/config'

function getInitials(label: string) {
  const words = label.trim().split(/\s+/).filter(Boolean)

  if (words.length === 0) {
    return 'APP'
  }

  return words
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase()
}

function getCustomSlotNumber(key: string) {
  return Number(key.replace('customapp', ''))
}

interface AppsSectionProps {
  open: boolean
  utilities: Utility[]
  appPaths: Record<string, string>
  appNames: Record<string, string>
  appIcons: Record<string, string>
  iconLoadErrors: Set<string>
  customSlots: number
  onOpenChange: (open: boolean) => void
  onAppNameChange: (key: string, name: string) => void
  onIconLoadError: (key: string) => void
  onBrowse: (key: string) => void
  onAddCustomSlot: () => void
  onRemoveCustomSlot: (slotNumber: number) => void
}

export function AppsSection({
  open,
  utilities,
  appPaths,
  appNames,
  appIcons,
  iconLoadErrors,
  customSlots,
  onOpenChange,
  onAppNameChange,
  onIconLoadError,
  onBrowse,
  onAddCustomSlot,
  onRemoveCustomSlot
}: AppsSectionProps) {
  return (
    <section className="space-y-4">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        className="flex w-full cursor-pointer items-center gap-2 px-1"
      >
        <h3 className="flex-1 text-left text-sm font-semibold uppercase tracking-wider text-(--accent)">
          Utility Apps
        </h3>
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-(--text-subtle) transition-transform duration-300 ${open ? 'rotate-0' : '-rotate-90'}`}
        >
          <path d="M3 6l5 5 5-5" />
        </svg>
      </button>
      <div
        className={`grid transition-all duration-300 ${open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
      >
        <div className="overflow-hidden">
          <div className="glass-surface rounded-2xl flex flex-col pt-1">
            {utilities.map((utility) => (
              <div
                key={utility.key}
                className="flex flex-col gap-2.5 border-b border-(--header-glass-border) px-5 py-4"
              >
                <div className="text-[10px] font-semibold uppercase tracking-widest text-(--text-secondary) opacity-80">
                  {utility.isCustom ? (
                    <div className="flex items-center gap-2">
                      <svg
                        width="11"
                        height="11"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="shrink-0 text-(--accent)"
                      >
                        <path d="M12 20h9" />
                        <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
                      </svg>
                      <input
                        type="text"
                        value={appNames[utility.key] || utility.name}
                        onChange={(e) => onAppNameChange(utility.key, e.target.value)}
                        className="min-w-0 flex-1 rounded-md border border-(--glass-border) bg-(--glass-bg) px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-(--text-secondary) outline-none transition-colors focus:border-(--accent) focus:text-(--text-primary)"
                        placeholder="App Name"
                        aria-label={`${utility.name} name`}
                        title="Editable app name"
                      />
                    </div>
                  ) : (
                    utility.name
                  )}
                </div>

                <div className="flex items-center gap-4">
                  {appIcons[utility.key] && !iconLoadErrors.has(utility.key) ? (
                    <img
                      src={appIcons[utility.key]}
                      alt="Icon"
                      className="h-8 w-8 object-contain drop-shadow-md shrink-0"
                      onError={() => onIconLoadError(utility.key)}
                    />
                  ) : (
                    <div
                      className="fallback-initial-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[10px] font-black"
                      title={`${appNames[utility.key] || utility.name} icon fallback`}
                    >
                      {getInitials(appNames[utility.key] || utility.name)}
                    </div>
                  )}

                  <input
                    type="text"
                    value={appPaths[utility.key] || ''}
                    readOnly
                    placeholder="No executable path set"
                    className="glass-recessed flex-1 truncate rounded-lg px-3 py-2 font-mono text-xs text-(--text-secondary) outline-none placeholder:text-(--text-subtle)"
                  />

                  {utility.isCustom && (
                    <button
                      type="button"
                      onClick={() => onRemoveCustomSlot(getCustomSlotNumber(utility.key))}
                      disabled={customSlots <= 1}
                      className="danger-action action-hover-scale flex h-9 w-9 cursor-pointer shrink-0 items-center justify-center rounded-xl"
                      title={`Remove ${appNames[utility.key] || utility.name}`}
                      aria-label={`Remove ${appNames[utility.key] || utility.name}`}
                    >
                      <svg
                        width="15"
                        height="15"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <path d="M3 6h18" />
                        <path d="M8 6V4h8v2" />
                        <path d="M19 6l-1 14H6L5 6" />
                        <path d="M10 11v5" />
                        <path d="M14 11v5" />
                      </svg>
                    </button>
                  )}
                  <button
                    onClick={() => onBrowse(utility.key)}
                    className="accent-surface-action action-hover-scale cursor-pointer shrink-0 rounded-xl px-4 py-2 text-xs font-semibold"
                  >
                    Browse
                  </button>
                </div>
              </div>
            ))}
            <div className="px-5 py-3">
              <button
                type="button"
                onClick={onAddCustomSlot}
                disabled={customSlots >= MAX_CUSTOM_SLOTS}
                className="accent-surface-action action-hover-scale flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold"
              >
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                >
                  <path d="M12 5v14" />
                  <path d="M5 12h14" />
                </svg>
                Add slot
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
