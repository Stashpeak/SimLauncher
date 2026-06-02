import type { ReactNode } from 'react'
import { Tooltip } from '../Tooltip'

interface ProfileEditorActionsProps {
  isDirty: boolean
  canDeleteProfile: boolean
  onSave: () => void
  onCloseAttempt: () => void
  onDeleteProfile: () => void
}

export function ProfileEditorActions({
  isDirty,
  canDeleteProfile,
  onSave,
  onCloseAttempt,
  onDeleteProfile
}: ProfileEditorActionsProps): ReactNode {
  return (
    <div className="flex gap-3 pt-2">
      <button
        type="button"
        onClick={onSave}
        aria-label={isDirty ? 'Save Profile (unsaved changes)' : 'Save Profile'}
        className="accent-surface-action action-hover-scale flex-1 cursor-pointer rounded-xl py-2.5 text-sm relative overflow-hidden"
      >
        {isDirty && (
          <span
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 flex h-2 w-2"
          >
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-(--accent) opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-(--accent)"></span>
          </span>
        )}
        Save Profile
      </button>
      <button
        type="button"
        onClick={onCloseAttempt}
        className="accent-surface-action action-hover-scale flex-1 cursor-pointer rounded-xl py-2.5 text-sm font-semibold"
      >
        Cancel
      </button>
      {canDeleteProfile && (
        <Tooltip label="Delete profile">
          <button
            type="button"
            onClick={onDeleteProfile}
            className="danger-action action-hover-scale flex h-11 w-11 cursor-pointer shrink-0 items-center justify-center rounded-xl transition-all"
            aria-label="Delete profile"
          >
            <svg
              aria-hidden="true"
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
        </Tooltip>
      )}
    </div>
  )
}
