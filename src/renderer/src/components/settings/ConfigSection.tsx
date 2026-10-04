import type { ReactNode } from 'react'

import { useSettingsMeta } from './SettingsMetaContext'

export function ConfigSection(): ReactNode {
  const { exportingConfig, importingConfig, onExportConfig, onImportConfig } = useSettingsMeta()
  const busy = exportingConfig || importingConfig

  return (
    <div className="p-5">
      <div className="flex flex-col gap-5">
        <div className="settings-label-group">
          <span className="settings-label">Backup and migration</span>
          <span className="settings-sublabel">
            Export or replace the complete SimLauncher JSON config
          </span>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <button
            type="button"
            // aria-disabled rather than `disabled`, for both buttons here
            // (#869, the #830 pattern). They go busy while a native file
            // dialog is up, and a button that becomes `disabled` drops focus
            // and refuses it back, so a keyboard user returned from the
            // picker to <body>. Dropping the handler keeps a busy click
            // inert; the #830 rule in App.css supplies the disabled look.
            onClick={busy ? undefined : onExportConfig}
            aria-disabled={busy || undefined}
            className="accent-surface-action action-hover-scale flex cursor-pointer items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-all active:scale-[0.98]"
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
            {exportingConfig ? 'Exporting...' : 'Export config'}
          </button>
          <button
            type="button"
            onClick={busy ? undefined : onImportConfig}
            aria-disabled={busy || undefined}
            className="accent-surface-action action-hover-scale flex cursor-pointer items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold transition-all active:scale-[0.98]"
          >
            <svg
              aria-hidden="true"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            {importingConfig ? 'Importing...' : 'Import config'}
          </button>
        </div>
      </div>
    </div>
  )
}
