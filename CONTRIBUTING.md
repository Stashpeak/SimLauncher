# Contributing to SimLauncher

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

1. Add an entry to `UTILITIES` in `src/renderer/src/lib/config.ts`:

   ```ts
   { key: 'myutil', name: 'My Utility' }
   ```

   For a user-renameable slot, add `isCustom: true`.

## Code style

- Run `npm run build` before submitting a PR.
- Keep changes focused, with one feature or fix per PR.
- Keep renderer code in React and TypeScript.

## Building the installer

```bash
npm run build
```

Output: `dist/SimLauncher Setup x.x.x.exe`

## Pull requests

- Target the `main` branch unless the issue says otherwise.
- Describe what changed and why in the PR description.
- For new games or utilities, include any required icon files in the PR.
