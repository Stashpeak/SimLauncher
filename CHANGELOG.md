# Changelog

All notable changes to SimLauncher are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Security
- Fixed critical Electron misconfiguration: `contextIsolation` now `true`, `nodeIntegration` now `false`
- Added `preload.js` with `contextBridge` for safe IPC — renderer no longer has direct Node.js access
- Replaced `child_process.exec()` with `spawn()` — app paths are no longer shell-interpolated
- Added path validation before launching executables

### Added
- User-facing error toast when an individual app fails to launch
- ESLint config and `npm run lint` script

### Changed
- File browser dialog no longer shows "All Files" option — restricted to `.exe` only
- `preload.js` added to electron-builder `files` list

### Documentation
- Rewrote `README.md` with features list, supported games/utilities, dev setup, and contribution guide
- Added `CHANGELOG.md`
- Added `CONTRIBUTING.md`

---

## [0.0.8] — 2025-11

### Added
- DCS World support

### Changed
- Updated Assetto Corsa icon

---

## [0.0.7] — 2025-10

### Added
- New games and icons
- Toast notification system (replaced status text)
- Accent color presets (Electric Aqua, SimHub Blue, Racing Green, etc.)
- Custom color picker with persistent state
- Launch button redesigned as icon button

### Changed
- Moved all frontend logic into `renderer.js`
- UI cleanup and theme variable refactor

---

## [0.0.5] — 2025-09

### Added
- Per-game profile editor (⚙️ icon inline with game button)
- "Launch game automatically" toggle per profile
- Custom app slots (×5) with editable names

---

## [0.0.4] — 2025-08

### Added
- Dark theme
- Game icon images
- Global utility/game path lists

---

## [0.0.2] — 2025-07

### Added
- Initial multi-app launch logic
- Settings tab with path inputs

---

## [0.0.1] — 2025-06

### Added
- Initial release
