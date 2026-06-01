# Changelog

All notable changes to SimLauncher are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Full per-release notes — including every linked issue and PR — are published on the
[GitHub Releases page](https://github.com/Stashpeak/SimLauncher/releases).

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
