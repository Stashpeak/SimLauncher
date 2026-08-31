# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npx install-electron # One-time after a fresh npm install — Electron >=42 no longer downloads its binary via postinstall
npm run dev          # Vite dev server + Electron (hot reload)
npm test             # Vitest run (all tests)
npm run test:watch   # Vitest watch mode
npx vitest run tests/main/processes.test.ts   # Run a single test file
npm run lint         # ESLint
npm run format       # Prettier (write)
npm run format:check # Prettier (check only)
npm run typecheck    # tsc + preload types check
npm run build        # Production build (electron-vite)
npm run dist:win     # Build + Windows installer
```

## Architecture

Three-process Electron app:

**Main process** (`src/main/`) — Node.js, no DOM.

- `index.ts` — entry point; boots tray, IPC handlers, window
- `store.ts` — `electron-store` instance; all persistent config lives here
- `ipc/` — IPC handlers (`config.ts`, `launch.ts`, `icons.ts`, `system.ts`, `context-menu.ts`, registered from `index.ts`); each file registers its own handlers
- `processes/` — process lifecycle subsystem:
  - `spawn.ts` — launches app executables via `child_process`
  - `kill.ts` — kills processes via `taskkill`; uses PowerShell `Get-Process` to match by full exe path (fail-closed: skips processes with null `ExecutablePath`)
  - `tasklist.ts` — thin cached wrapper around `tasklist /fo csv`
  - `running.ts` — publishes running-app state to renderer via IPC push
  - `state.ts` — in-memory sets: `runningProcesses`, `unclosedProcesses`
- `profiles.ts` — reads/writes per-game profile data from store
- `migrator.ts` — one-time data migrations on startup

**Preload** (`src/preload/`) — bridge between main and renderer.

- `api.ts` — `ElectronAPI` interface: the authoritative contract for all IPC calls. Changing a handler signature requires updating this interface and `index.ts`'s `contextBridge.exposeInMainWorld` call.

**Renderer** (`src/renderer/src/`) — React 19 + TypeScript + Tailwind CSS v4.

- `lib/electron.ts` — typed wrappers around `window.electronAPI` for most renderer→main calls
- `lib/store.ts` — the other renderer→main surface: settings, profiles, config import/export, onboarding and migration flags
- `lib/config.ts` — re-exports the shared registries plus renderer-side profile/slot helpers. It is **not** where games and utilities are defined; see `src/shared/` below
- `contexts/ThemeContext.tsx` — accent color + dark/light/system theme
- `hooks/` — `useRunningApps`, `useGameProfile`, `useProfileEditor`, etc.
- Two top-level views: `GameList` (default) and `SettingsView`; switching between them is handled in `App.tsx`

**Shared** (`src/shared/`) — imported by all three processes, so it must stay free of Node and DOM APIs.

- `domain/registries.ts` — `GAMES` and `BUILT_IN_UTILITIES`: the single source of truth for which games and utilities exist. `KNOWN_GAME_KEYS` is **derived** from `GAMES`, so adding a game cannot forget it
- `domain/profile.ts`, `domain/slots.ts`, `domain/guards.ts` — profile shapes, custom-slot rules, runtime type guards

## Key conventions

**IPC flow:** renderer calls `window.electronAPI.X()` (typed via `ElectronAPI`) → preload bridges to main → main handler in `src/main/ipc/` responds. Push events go the other way: main calls `sendToRenderer(event, payload)` → renderer subscribes via `onX(cb)`.

**Adding a new game:** add an entry to `GAMES` in `src/shared/domain/registries.ts` and place `<key>.png` in `assets/`. That is the whole recipe: `KNOWN_GAME_KEYS`, which the settings sanitizer checks paths against, is derived from `GAMES` rather than hand-maintained, so a new game cannot end up unable to save its path.

**Tailwind:** v4 via `@tailwindcss/vite` — no `tailwind.config.js`. Custom tokens go in `@theme {}` blocks in `App.css`.

**Tests:** Vitest with two named projects — `renderer` (jsdom, `tests/renderer/**`) and `main` (node, `tests/main/**`). Tests in `tests/main/` can't use browser APIs; tests in `tests/renderer/` can't import Electron modules.

**electron-store in tests:** requires `projectName: 'SimLauncher'` in the constructor (already set in `store.ts`). Without it, electron-store throws in a non-Electron test environment.

**Commit messages** must reference an issue (`#N`), which the `.githooks/commit-msg` hook enforces; a `docs:` subject line is exempt. Conventional Commits are enforced on the **PR title** by `.github/workflows/pr-title.yml`, not on individual commits. A PR touching anything outside `tests/`, `docs/`, `.github/`, Markdown files, editor and tooling dotfiles, and tsconfig must also tick one box in the **Smoke check** section of the PR template, enforced by `.github/workflows/pr-smoke-note.yml`; that block is what the next release's manual smoke checklist is built from. `Needs no manual check` is a normal answer, but it is adjudicated against the diff at release time and a wrong one is named in the smoke closeout, so write the honest reason rather than the one that goes green.

## Code documentation

Comment the WHY, not the WHAT — explain non-obvious decisions, constraints, invariants, gotchas, and security-sensitive steps; never write comments that restate the code. Doc-comment public/exported items (TS JSDoc) where applicable. English only. Applies to AI agents too.

## Rejected approaches

[`AGENTS.md`](AGENTS.md) carries a **Rejected approaches** section plus a list of work no agent can settle by reading code (anything needing a profiler, a screen reader, or a product decision). Read it before proposing an optimization or an a11y change; it exists because the same handful of ideas kept arriving as PRs and getting closed for the same reasons.
