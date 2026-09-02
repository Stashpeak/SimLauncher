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

## Tooling facts that get guessed wrong

- The package manager is **npm**. There is no pnpm and no yarn; `package-lock.json` is the only lockfile. Never generate a `pnpm-lock.yaml`.
- Dependency pins live in the `overrides` block of [`package.json`](package.json), which is npm-specific. `npm audit --omit=dev` runs inside the required `build` job, so a stale override fails CI for the whole repo, not just one PR.
- This is a fixed-size desktop window, not a website. Skip-to-content links, breadcrumbs, viewport breakpoints and mobile responsive behaviour do not apply.
- There is no database, no HTTP API and no server. N+1 queries, indexes, pagination, connection pooling and payload compression have nothing to point at here.
- Do not create `.jules/` or `.Jules/` scratch files. They are gitignored, so they only add noise to a diff.

## Rejected approaches

Do not re-propose these. Each was tried and closed, and the reasoning is recorded on the linked issue.

- **`React.memo` on `GameList` rows or `RunningAppsStrip`.** Proposed five times (PRs #650, #744, #786, #791, #807) and closed every time. The memos cannot bail out, because `GameList` rebuilds `runningAppIcons` and the row callbacks on every render, so the shallow prop comparison always fails. Stabilizing those props is the actual fix and is tracked in #651, behind a profiling gate. `React.memo` on its own is inert here.
- **A descriptive `alt` on an icon that sits next to its own name.** The name is already adjacent text, so a descriptive `alt` makes a screen reader announce it twice. Use `alt=""`. The named form (`alt={game.name}`) is only for an icon that _is_ the label, with no adjacent text repeating it. See `AppsSection.tsx` versus `GameIcon.tsx`.
- **Running a formatter across files you touched.** Prettier already runs with its own config, and a reformat buries the real change in noise.

## Work that automated agents should not open a PR for

Comment on the issue instead. Nothing here can be satisfied by reading code:

- profiling, benchmarks, or any before/after measurement
- verification with a real screen reader
- a copy, product, or design decision
- anything gated on a smoke test or a check against an installed build
