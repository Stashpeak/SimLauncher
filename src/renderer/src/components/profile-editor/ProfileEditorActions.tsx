interface ProfileEditorActionsProps {
  isDirty: boolean
  canDeleteProfile: boolean
  onSave: () => void
  onLaunch: () => void
  onCloseAttempt: () => void
  onDeleteProfile: () => void
}

export function ProfileEditorActions({
  isDirty,
  canDeleteProfile,
  onSave,
  onLaunch,
  onCloseAttempt,
  onDeleteProfile
}: ProfileEditorActionsProps) {
  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onLaunch}
          className="accent-action action-hover-scale flex-[2] cursor-pointer rounded-xl py-2.5 text-sm font-bold"
        >
          Launch
        </button>
        <button
          type="button"
          onClick={onSave}
          className="accent-surface-action action-hover-scale flex-1 cursor-pointer rounded-xl py-2.5 text-sm relative overflow-hidden"
        >
          {isDirty && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-(--accent) opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-(--accent)"></span>
            </span>
          )}
          Save
        </button>
      </div>

      <div className="flex gap-3">
        <button
          type="button"
          onClick={onCloseAttempt}
          className="accent-surface-action action-hover-scale flex-1 cursor-pointer rounded-xl py-2.5 text-sm font-semibold"
        >
          Cancel
        </button>
        {canDeleteProfile && (
          <button
            type="button"
            onClick={onDeleteProfile}
            className="danger-action action-hover-scale flex h-11 w-11 cursor-pointer shrink-0 items-center justify-center rounded-xl transition-all"
            title="Delete profile"
            aria-label="Delete profile"
          >
            <svg
              width="16"
              height="16"
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
      </div>
    </div>
  )
}
