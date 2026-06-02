# Contributing to SimLauncher

**Requirements:** Node.js 24+
**Stack:** Electron, React 19, TypeScript, Tailwind CSS v4, electron-vite

## Dev setup

```bash
git clone https://github.com/Stashpeak/SimLauncher
cd SimLauncher
npm install
npm run dev
```

## Adding a new game

1. Add an entry to `GAMES` in `src/renderer/src/lib/config.ts`:

   ```ts
   { key: 'mygame', name: 'My Game', icon: 'assets/mygame.png' }
   ```

2. Place a PNG icon named `mygame.png` in `assets/`.

## Adding a new utility

1. Add an entry to `BUILT_IN_UTILITIES` in `src/renderer/src/lib/config.ts`:

   ```ts
   { key: 'myutil', name: 'My Utility' }
   ```

   `UTILITIES` is a computed export that concatenates `BUILT_IN_UTILITIES` with the
   user's custom slots, so built-in utilities go in `BUILT_IN_UTILITIES` — not in
   `UTILITIES`. User-renameable slots are generated automatically as `customapp<N>`
   keys and must not be authored by hand.

## Code style

- Run `npm run build`, `npm run typecheck`, `npm run lint`, and `npm run format:check` before submitting a PR (CI gates all four).
- Keep changes focused, with one feature or fix per PR.
- Keep renderer code in React and TypeScript.

## Building the installer

```bash
# Build app output
npm run build

# Build Windows installer (.exe)
npm run dist:win
```

Output will appear in `dist/`.

## Pull requests

- Target the `main` branch unless the issue says otherwise.
- Describe what changed and why in the PR description.
- For new games or utilities, include any required icon files in the PR.
