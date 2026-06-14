# Changelog

All notable changes to SimLauncher are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Full per-release notes — including every linked issue and PR — are published on the
[GitHub Releases page](https://github.com/Stashpeak/SimLauncher/releases).

## [Unreleased]

## [1.0.0] - 2026-06-14

### Added

- Each release now ships SHA-256 checksums (`SHA256SUMS.txt`) and a CycloneDX SBOM (`sbom.cdx.json`) alongside the installer, so you can verify download integrity and inspect the full dependency inventory.
- Unexpected background errors are now surfaced as a notification instead of being swallowed silently.
- Unexpected crashes in the app's main process are now recorded to a `main-error.log` file in the app's data folder, so issues on your machine are easier to diagnose.
- An "Open logs folder" button in Settings → About opens the folder with that crash log and your settings file, so it's easy to find when reporting an issue.
- Utilities in a profile's launch order can now be reordered with the keyboard (up/down buttons), not only by mouse drag.
- A "Close Apps" option in the system tray menu closes all running companion apps at once (after a confirmation); your game is left untouched. When nothing is running it simply tells you so.
- Windows High Contrast support: in a Contrast theme the keyboard focus ring, button borders, the toggle on/off state and the running / unsaved / selected dots all stay visible instead of collapsing into one colour.
- The running-app warning icon is now operable by keyboard and screen reader — focus it and press Enter or Space to open its Dismiss menu, instead of right-click only.

### Fixed

- A corrupted or unreadable settings file no longer prevents SimLauncher from starting: the unreadable file is set aside, the app launches with default settings, and a notice explains the reset. Profile migration is hardened the same way, so a malformed legacy profile can't block startup either.
- A maximized window now reopens at your previous restored size instead of the full-screen rectangle.
- The maximize/restore button icon now stays correct when the window is snapped or restored through Windows shortcuts (Win+Up, aero-snap, taskbar double-click), not just the title-bar button.
- App-argument parsing now follows the Windows convention for quoted paths ending in a backslash (e.g. `"C:\My Path\" --flag`), so the rest of the arguments are no longer swallowed into one token.
- Closing an app whose executable name contains a single quote now works (the process lookup no longer builds an invalid query).

### Changed

- The app now honors the system "reduce motion" setting, Settings toggles show a keyboard focus ring, and Escape closes the import-preview and color-picker dialogs.
- The process lookup used when closing apps now times out instead of stalling the close pipeline on a wedged system service.
- Smaller installer: frontend libraries (React, Tailwind, etc.) are bundled by Vite into the app's own code, so their separate package copies are no longer shipped in the installer, trimming the footprint.
- Checking for updates while offline now shows a calm "can't reach the update server — check your connection" notice instead of a generic update-failure error.
- A broad screen-reader and keyboard accessibility pass: launch progress, launch failures, "now running", companion-apps-closed and update-available status are now spoken through a dedicated live region (errors interrupt); the games and settings screens expose proper headings, landmarks, list semantics and a per-screen window title; switching screens or pressing Escape moves keyboard focus into the visible screen instead of stranding it; and every control shows a visible focus ring, with idle icon buttons brightened to meet contrast.
- The accent colour is now the SimLauncher teal everywhere — the keyboard focus ring and a brief startup flash that could still show the old purple are gone.
- Updated the application icon to the current SimLauncher branding.

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

[Unreleased]: https://github.com/Stashpeak/SimLauncher/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Stashpeak/SimLauncher/compare/v0.9.10...v1.0.0
[0.9.10]: https://github.com/Stashpeak/SimLauncher/compare/v0.9.9...v0.9.10
[0.9.9]: https://github.com/Stashpeak/SimLauncher/compare/v0.9.8...v0.9.9
[0.9.8]: https://github.com/Stashpeak/SimLauncher/compare/v0.9.7...v0.9.8
[0.9.7]: https://github.com/Stashpeak/SimLauncher/compare/v0.9.6...v0.9.7
