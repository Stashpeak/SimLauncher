# Contributing to SimLauncher

**Requirements:** Node.js 24+
**Stack:** Electron, React 19, TypeScript, Tailwind CSS v4, electron-vite

## Dev setup

```bash
git clone https://github.com/Stashpeak/SimLauncher
cd SimLauncher
npm install
npx install-electron   # Electron >=42 no longer downloads its binary via postinstall
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

   Built-in utilities go in `BUILT_IN_UTILITIES`. The user's custom slots are
   generated automatically as `customapp<N>` keys by `getUtilities(customSlots)`
   and must not be authored by hand.

2. Mirror the new key (same key set, same order) in the two places that
   duplicate `BUILT_IN_UTILITIES` for the main process:
   - `BUILT_IN_UTILITY_KEYS` in `src/main/profiles.ts` — order here is the
     default launch order for legacy flat-boolean profiles.
   - `KNOWN_UTILITY_KEYS` in `src/main/store.ts` — the config-import allowlist;
     forgetting a key here silently drops that utility's saved exe path.

3. Optionally bundle a curated icon: set `icon: 'assets/myutil.png'` on the
   config entry and place the PNG in `assets/`. For a built-in slot the app
   identity is known, so once an entry declares `icon`, that bundled asset is
   shown **first** — ahead of the Windows shell-extracted icon from the
   user's configured exe, with shell extraction only as a fallback and
   initials last (#652, precedence flipped in #727). Shell icon extraction is
   unreliable across app versions/icon formats and can "succeed" with a
   broken image (it did for Crew Chief — a black-square alpha artifact),
   which shell-first would keep forever once cached. Built-ins that don't
   declare `icon` (e.g. Second Monitor, no asset yet) and custom app slots
   keep the original shell → initials order.

## Code style

- Run `npm test`, `npm run build`, `npm run typecheck`, `npm run lint`, and `npm run format:check` before submitting a PR (CI gates all five).
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
