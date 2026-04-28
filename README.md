# SimLauncher

A Windows desktop app for simracing enthusiasts that launches sim games together with companion utilities such as SimHub, Crew Chief, and Trading Paints in a single click.

<table>
  <tr>
    <td><img alt="Launcher Tab" src="docs/screenshots/Launcher Tab.png" /></td>
    <td><img alt="Profile Editor" src="docs/screenshots/Launcher Tab - Profile Editor.png" /></td>
  </tr>
  <tr>
    <td><img alt="Settings - Appearance" src="docs/screenshots/Settings - Appearance.png" /></td>
    <td><img alt="Settings - Games" src="docs/screenshots/Settings - Games.png" /></td>
  </tr>
  <tr>
    <td><img alt="Settings - Apps" src="docs/screenshots/Settings - Apps.png" /></td>
    <td><img alt="No Games Configured" src="docs/screenshots/Launcher Tab - No Games Configured.png" /></td>
  </tr>
</table>

---

## Who is this for?

SimLauncher is built for people who run non-trivial sim setups and are tired of manual prep every time they want to drive.

You'll likely benefit from this if you:

- Run multiple sims (iRacing, AC, ACC, AMS2, etc.)
- Switch between different setups (VR vs triples, motion on/off, etc.)
- Use multiple companion apps (SimHub, CrewChief, overlays, telemetry, wheelbase software...)
- Care about launch order, delays, and reliability
- Want a single click to go from desktop to fully ready rig

**This app is probably unnecessary for you if:**

- You run one sim and one or two apps
- You're fine with everything starting with Windows
- You don't need different setups (e.g. always same screens, same config)
- You don't care about launch order or coordination between apps

In that case, your current setup is already simple enough.

---

## Features

- One-click launch of a sim game plus selected utilities
- Per-game profiles with drag-to-reorder launch order
- Optional auto-launch of the game itself
- 1–20 configurable custom app slots with editable names
- Configurable launch delay between apps (1s / 1.5s / 2s presets, or custom up to 30s)
- Automotive-themed accent color presets and a custom color picker
- Light, dark, and system theme modes
- Kill and relaunch controls for running companion apps
- Config export and import
- Start with Windows, start minimized, and minimize to tray options
- Toast notifications for launch status and errors

## Supported Games

Assetto Corsa, Assetto Corsa Competizione, Assetto Corsa Evo, Assetto Corsa Rally, Automobilista, Automobilista 2, BeamNG, DCS World, Dirt Rally, Dirt Rally 2.0, EA WRC, F1 24, F1 25, iRacing, Le Mans Ultimate, Project Motor Racing, RaceRoom Racing Experience, Richard Burns Rally, Rennsport, rFactor, rFactor 2

## Supported Utilities

SimHub, Crew Chief, Trading Paints, Garage 61, Second Monitor, plus 20 custom app slots

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

## Support

If SimLauncher saves you time on race day, a small tip is appreciated: [paypal.me/shieldxx](https://paypal.me/shieldxx)

---

## License

GNU GPL v3. See [LICENSE](LICENSE).
