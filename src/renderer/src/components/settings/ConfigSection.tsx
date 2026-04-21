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
      <div className="glass-surface rounded-2xl flex flex-col p-5 gap-4">
        <div className="flex flex-col gap-1">
          <span className="text-sm font-medium text-(--text-primary)">Backup and migration</span>
          <span className="text-[10px] text-(--text-muted)">
            Export or replace the complete SimLauncher JSON config
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={onExportConfig}
            disabled={exportingConfig || importingConfig}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-(--glass-bg-elevated) px-4 py-2.5 text-xs font-bold text-(--text-primary) transition-all hover:bg-(--glass-border) active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 disabled:active:scale-100"
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
              className="shrink-0"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M7 10l5 5 5-5" />
              <path d="M12 15V3" />
            </svg>
            {exportingConfig ? 'Exporting...' : 'Export config'}
          </button>
          <button
            type="button"
            onClick={onImportConfig}
            disabled={exportingConfig || importingConfig}
            className="flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-(--glass-bg-elevated) px-4 py-2.5 text-xs font-bold text-(--text-primary) transition-all hover:bg-(--glass-border) active:scale-[0.98] disabled:cursor-wait disabled:opacity-60 disabled:active:scale-100"
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
              className="shrink-0"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <path d="M17 8l-5-5-5 5" />
              <path d="M12 3v12" />
            </svg>
            {importingConfig ? 'Importing...' : 'Import config'}
          </button>
        </div>
      </div>
    </section>
  )
}
