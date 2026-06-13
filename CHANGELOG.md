# Changelog

All notable changes to SimLauncher are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Full per-release notes — including every linked issue and PR — are published on the
[GitHub Releases page](https://github.com/Stashpeak/SimLauncher/releases).

## [Unreleased]

### Fixed

- The maximize/restore button icon now stays correct when the window is snapped or restored through Windows shortcuts (Win+Up, aero-snap, taskbar double-click), not just the title-bar button.
- App-argument parsing now follows the Windows convention for quoted paths ending in a backslash (e.g. `"C:\My Path\" --flag`), so the rest of the arguments are no longer swallowed into one token.

### Changed

- The process lookup used when closing apps now times out instead of stalling the close pipeline on a wedged system service.

## [0.9.10] - 2026-06-12

### Fixed

- Launched apps now start in their own folder (working directory). Apps that load files relative to it — like iOverlay's overlay graphics — could previously fail in a loop and leak memory until an out-of-memory freeze when launched through SimLauncher. Elevated launches pass the working directory as well.

## [0.9.9] - 2026-06-02

### Added

- A separate "Show tray icon" toggle, decoupled from minimize-to-tray — hide the tray icon entirely, and the close button then quits.
- Single-instance lock: launching SimLauncher again focuses the running window (including restore from tray) instead of starting a second copy.
- Custom tooltips and a styled context menu replacing the native OS ones, with tracked-aware dismiss labels on running-app icons.
- A Discard button on the sticky unsaved-changes bar, behind a modal confirm.
- Per-section dirty indicators in Settings, a direct New profile button in the editor header, and an honored launch delay up to 30 s (previously capped silently at 5 s).

### Changed

- Accessibility pass across the app: named icon-only buttons, dialog roles and labels, real modal focus trapping and restore, live regions for toasts, and hidden tab views removed from the focus order and accessibility tree.
- Reverting an edit back to its saved value now clears the unsaved-changes bar automatically.
- Unified frosted-glass treatment across the save bar and profile dropdown.

### Fixed

- Profiles created via the editor "+" are removed on discard — no more orphan "New Profile" entries.
- Ghost "unsaved changes" indicator on Utility Apps after a profile save.
- The brand wordmark renders crisp at every zoom level.
- Enter on a focused dialog button no longer also fires the default Save action.

## [0.9.8] - 2026-06-01

### Added

- Unified unsaved-changes UX across Settings and the Profile Editor: an app-level sticky save bar, tab/close confirmation dialogs, and profile-name dirty tracking.
- Dynamic context-menu labels for utility icon dismissal — labels reflect the actual app instead of generic text.
- Per-utility-key argument resolution, enabling dual-slot same-exe profiles with distinct launch arguments.

### Fixed

- Clearer wrapper-exit messaging explaining lost tracking and how to restore it.
- Suppressed the misleading "couldn't be closed" toast when the launched exe is already gone.
- Hardened kill verification and the spawn exit handler against tasklist-read failures and same-key relaunch races.
- A Settings-tab window close now shows the confirm dialog instead of silently minimizing to tray.
- The Profile Editor close (X) no longer drops unsaved changes silently.
- The accent color picker is now a floating popover, so it no longer shifts the layout.

### Changed

- Split the process logic into `processes/{kill,spawn,state,running,tasklist}.ts` with clean layered imports.
- Unified path normalization across the main and renderer processes.
- Explicit return types on all exported functions, hooks, and components, plus broader test coverage.

## [0.9.7] - 2026-05-21

### Added

- Renderer Content Security Policy, enforced via a build-time meta tag (packaged builds) and an HTTP response header (dev mode).

### Fixed

- Process-mismatch warning icons now persist until manually dismissed instead of auto-clearing after 60s.

### Changed

- Hardened IPC handlers with deep input validation, prototype-pollution guards, and game-key allow-lists.
- Added runtime type guards for all store-backed data, so a tampered config file can no longer crash settings reads.

## Earlier releases

SimLauncher has shipped continuously since **v0.1.0 (2026-04-17)** — including the
per-sim profile system, config export/import, dynamic custom app slots, the
auto-updater and tray UX, and the 2026 design overhaul. See the
[GitHub Releases page](https://github.com/Stashpeak/SimLauncher/releases) for the
complete history and detailed notes.

[Unreleased]: https://github.com/Stashpeak/SimLauncher/compare/v0.9.10...HEAD
[0.9.10]: https://github.com/Stashpeak/SimLauncher/compare/v0.9.9...v0.9.10
[0.9.9]: https://github.com/Stashpeak/SimLauncher/compare/v0.9.8...v0.9.9
[0.9.8]: https://github.com/Stashpeak/SimLauncher/compare/v0.9.7...v0.9.8
[0.9.7]: https://github.com/Stashpeak/SimLauncher/compare/v0.9.6...v0.9.7
