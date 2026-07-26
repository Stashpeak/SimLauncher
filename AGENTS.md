# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Overview

Electron desktop app for simracing enthusiasts — React + TypeScript + Tailwind CSS frontend, Electron + Vite build stack.

## Commands

- **Dev:** `npm run dev` (Vite dev server + Electron)
- **Build:** `npm run build`
- **Windows installer:** `npm run dist:win`
- **Lint:** `npm run lint`
- **Test:** `npm test` (Vitest)

## TypeScript / Frontend

- `strict: true` in [`tsconfig.json`](tsconfig.json)
- Tailwind CSS via `@tailwindcss/vite` — no `tailwind.config.js`; use `@theme` in CSS
- Components in `src/renderer/src/components/` — named exports
- Game and utility registries in `src/shared/domain/registries.ts` (`GAMES`, `BUILT_IN_UTILITIES`); `src/renderer/src/lib/config.ts` re-exports them alongside renderer-side profile helpers

## Electron

- Config in [`electron.vite.config.ts`](electron.vite.config.ts)
- Builder config in [`electron-builder.yml`](electron-builder.yml)
- Windows installer output: `dist/`

## Git Hooks

- Commit messages MUST reference an issue (`#N`); a `docs:` subject line is exempt
- Hook at [`.githooks/commit-msg`](.githooks/commit-msg) enforces only that reference, not the commit format
- Conventional Commits are enforced on the PR title by [`.github/workflows/pr-title.yml`](.github/workflows/pr-title.yml)

## Architecture Notes

- Adding a new game: add an entry to `GAMES` in `src/shared/domain/registries.ts` and place a `<key>.png` icon in `assets/`. That is the whole recipe: `KNOWN_GAME_KEYS`, which the settings sanitizer checks saved paths against, is derived from `GAMES` rather than hand-maintained
- `src/shared/` is imported by all three processes, so it must stay free of Node and DOM APIs
- Config export/import handles user settings persistence

## Code documentation

- Comment the WHY, not the WHAT — explain non-obvious decisions, constraints, invariants, gotchas, and security-sensitive steps; never write comments that restate the code.
- Doc-comment public/exported items (TS JSDoc) where applicable. English only.
- Applies to AI agents too.
