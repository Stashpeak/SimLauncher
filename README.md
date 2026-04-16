# SimLauncher

A Windows desktop app for simracing enthusiasts that launches sim games together with companion utilities such as SimHub, Crew Chief, and Trading Paints in a single click.

<img width="786" height="593" alt="Launcher tab" src="https://github.com/user-attachments/assets/7b1641ab-de53-4b8c-ab8a-cbcf763ad283" />

<img width="786" height="706" alt="Settings tab" src="https://github.com/user-attachments/assets/421edd48-3080-403c-b046-033df0df8f66" />

<img width="786" height="706" alt="Profile editor" src="https://github.com/user-attachments/assets/cfccf9f9-216c-49eb-a4c4-4fb3e3d7a0f3" />

---

## Features

- One-click launch of a sim game plus selected utilities
- Per-game profiles for choosing which apps open with each title
- Optional auto-launch of the game itself
- 5 custom app slots with editable names
- Accent color presets and a custom color picker
- Toast notifications for launch status and errors

## Supported Games

Assetto Corsa, Assetto Corsa Competizione, Assetto Corsa Evo, Assetto Corsa Rally, Automobilista, Automobilista 2, BeamNG, DCS World, Dirt Rally, Dirt Rally 2.0, EA WRC, F1 24, F1 25, iRacing, Le Mans Ultimate, Project Motor Racing, RaceRoom Racing Experience, Richard Burns Rally, Rennsport, rFactor, rFactor 2

## Supported Utilities

SimHub, Crew Chief, Trading Paints, Garage 61, Second Monitor, plus 5 custom app slots

---

## Installation

1. Download the latest installer from [Releases](../../releases).
2. Run the installer and follow the setup wizard.
3. Open SimLauncher, go to Settings, set paths to your games and utilities, then save.
4. On the Launcher screen, click the settings icon next to a game to choose which utilities launch with it.
5. Click Launch to start everything at once.

---

## Development

**Requirements:** Node.js 20+

```bash
# Install dependencies
npm install

# Run in development
npm run dev

# Build app output
npm run build

# Build Windows installer
npm run dist:win
```

The built installer will appear in `dist/`.

**Stack:** Electron, React, TypeScript, Tailwind CSS, electron-vite

**Adding a new game:**

1. Add an entry to `GAMES` in `src/renderer/src/lib/config.ts`.
2. Place a `<key>.png` icon in `assets/`.

---

## License

GNU GPL v3. See [LICENSE](LICENSE).
