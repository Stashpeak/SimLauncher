interface ConfigSectionProps {
  exportingConfig: boolean
  importingConfig: boolean
  onExportConfig: () => void
  onImportConfig: () => void
}

export function ConfigSection({
  exportingConfig,
  importingConfig,
  onExportConfig,
  onImportConfig
}: ConfigSectionProps) {
  return (
    <section className="space-y-4">
      <h3 className="text-sm font-semibold uppercase tracking-wider text-(--accent) px-1">
        Config
      </h3>
      <div className="glass-surface rounded-2xl flex flex-col pt-1">
        <div className="settings-row border-none">
          <div className="settings-label-group">
            <span className="settings-label">Backup and migration</span>
            <span className="settings-sublabel">
              Export or replace the complete SimLauncher JSON config
            </span>
          </div>
          <div className="settings-control gap-3">
            <button
              type="button"
              onClick={onExportConfig}
              disabled={exportingConfig || importingConfig}
              className="accent-surface-action flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M7 10l5 5 5-5" />
                <path d="M12 15V3" />
              </svg>
              {exportingConfig ? 'Exporting...' : 'Export'}
            </button>
            <button
              type="button"
              onClick={onImportConfig}
              disabled={exportingConfig || importingConfig}
              className="accent-surface-action flex cursor-pointer items-center justify-center gap-2 rounded-xl px-4 py-2 text-xs font-bold"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="shrink-0"
              >
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                <path d="M17 8l-5-5-5 5" />
                <path d="M12 3v12" />
              </svg>
              {importingConfig ? 'Importing...' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
