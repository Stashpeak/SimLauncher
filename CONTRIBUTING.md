# Contributing to SimLauncher

## Dev setup

```bash
git clone https://github.com/Shieldxx/SimLauncher
cd SimLauncher
npm install
npm start
```

## Adding a new game

1. Add an entry to `CONFIG.GAMES` in `renderer.js`:
   ```js
   { key: 'mygame', id: 'mygame-path', name: 'My Game' }
   ```
2. Place a PNG icon named `mygame.png` in `assets/` (recommended size: ~200×200px, square).

## Adding a new utility

1. Add an entry to `CONFIG.UTILITIES` in `renderer.js`:
   ```js
   { key: 'myutil', id: 'myutil-path', name: 'My Utility' }
   ```
   For a user-renameable slot, add `isCustom: true, defaultName: 'My Utility'`.

## Code style

- Run `npm run lint` before submitting a PR.
- Keep changes focused — one feature or fix per PR.
- No TypeScript, no build step beyond `electron-builder`.

## Building the installer

```bash
npm run dist
```

Output: `dist/SimLauncher Setup x.x.x.exe`

## Pull requests

- Target the `main` branch.
- Describe what changed and why in the PR description.
- For new games/utilities, include the icon file in the PR.
