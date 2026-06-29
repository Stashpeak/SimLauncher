# SimLauncher

[![Latest release](https://img.shields.io/github/v/release/Stashpeak/SimLauncher?sort=semver&cacheSeconds=3600)](../../releases)
[![Discord](https://img.shields.io/badge/Discord-Join-5865F2?logo=discord&logoColor=white)](https://discord.gg/37BPprjazF)
[![Downloads](https://img.shields.io/github/downloads/Stashpeak/SimLauncher/total)](../../releases)
[![CI](https://img.shields.io/github/actions/workflow/status/Stashpeak/SimLauncher/ci.yml?branch=main&label=CI)](../../actions/workflows/ci.yml)
[![License: GPL-3.0](https://img.shields.io/github/license/Stashpeak/SimLauncher)](LICENSE)
![Platform: Windows](https://img.shields.io/badge/platform-Windows-0078D6)

One-click startup for your entire sim racing setup.

Launch iRacing, Assetto Corsa, ACC and other sims on Windows, together with SimHub, Crew Chief, Trading Paints, overlays, telemetry tools and wheelbase software — automatically.

https://github.com/user-attachments/assets/0befc41c-ad71-4d75-930c-9bfa680c3ece

**➡️ [Download SimLauncher for Windows](../../releases/latest)** · 💬 **[Join the Discord](https://discord.gg/37BPprjazF)**

> On first launch Windows SmartScreen may warn that the publisher is unrecognized — the installer isn't code-signed yet. Click **More info → Run anyway**.

<table>
  <tr>
    <td><img alt="Launcher Tab" src="docs/screenshots/Launcher%20Tab.png" /></td>
    <td><img alt="Profile Editor" src="docs/screenshots/Launcher%20Tab%20-%20Profile%20Editor.png" /></td>
  </tr>
  <tr>
    <td><img alt="Settings - Appearance" src="docs/screenshots/Settings%20-%20Appearance.png" /></td>
    <td><img alt="Settings - Games" src="docs/screenshots/Settings%20-%20Games.png" /></td>
  </tr>
  <tr>
    <td><img alt="Settings - Apps" src="docs/screenshots/Settings%20-%20Apps.png" /></td>
    <td><img alt="No Games Configured" src="docs/screenshots/Launcher%20Tab%20-%20No%20Games%20Configured.png" /></td>
  </tr>
</table>

**Jump to:** [Who it's for](#who-is-this-for) · [Features](#features) · [Supported games](#supported-games) · [Installation](#installation) · [Troubleshooting](#troubleshooting) · [Build from source](#building-from-source) · [Security](#security) · [Support](#support)

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
- Integrated auto-updates to stay current with the latest features
- Optional auto-launch of the game itself
- 1–20 configurable custom app slots with editable names
- Configurable launch delay between apps (1s / 1.5s / 2s presets, or custom up to 30s)
- Automotive-themed accent color presets and a custom color picker
- Light, dark, and system theme modes
- Kill and relaunch controls for running companion apps
- Config export and import
- Start with Windows, start minimized, and minimize to tray options
- Toast notifications for launch status and errors

---

## Planned Features

- **Optional auto-close**: Automatically terminate companion apps and utilities when the sim game session ends.
- **Smart path detection**: Automatic detection of installed sims and common utility app installation paths.
- **Themed color collections**: Expanded accent presets and curated color palettes for deeper UI personalization.
- **Enhanced session management**: Session-state-aware app launching and advanced restart triggers.
- **Global profile actions**: Explicit "Close Full Profile" and "Close Game" actions for better control.

---

## Supported Games

Assetto Corsa, Assetto Corsa Competizione, Assetto Corsa Evo, Assetto Corsa Rally, Aerofly FS 4, Automobilista, Automobilista 2, BeamNG, DCS World, Dirt Rally, Dirt Rally 2.0, EA WRC, F1 24, F1 25, IL-2 Sturmovik: Great Battles, iRacing, Le Mans Ultimate, Microsoft Flight Simulator 2020, Microsoft Flight Simulator 2024, Prepar3D, Project Motor Racing, RaceRoom Racing Experience, Richard Burns Rally, Rennsport, rFactor, rFactor 2, X-Plane 12

---

## Supported Utilities

**Built-in:** SimHub, Crew Chief, Trading Paints, Garage 61, Second Monitor. **Anything else** — overlays, telemetry tools, wheelbase software — goes in up to 20 user-added custom app slots, each launched the same way.

---

## Installation

1. Download the latest installer from [Releases](../../releases).
2. Run the installer and follow the setup wizard.
3. Open SimLauncher, go to Settings, set paths to your games and utilities, then save.
4. On the Launcher screen, click the settings icon next to a game to choose which utilities launch with it.
5. Click Launch to start everything at once.

---

## Troubleshooting

### "Windows protected your PC" (SmartScreen)

The installer isn't code-signed yet, so SmartScreen may warn on first launch. Click **More info → Run anyway**.

### A game won't launch

- Check that the executable path in Settings points to the correct `.exe`.
- If the game is already running, SimLauncher intentionally skips re-launching it (reported as "skipped — already running"), so this is expected rather than a failure. Close it first if you want a fresh launch.
- If the game needs elevated permissions, try running SimLauncher as Administrator.

### A utility isn't detected as running

- Some utilities (e.g. SimHub) take longer to start — increase the launch delay in Settings.
- Process detection matches by the executable's file name (not the full path), so a renamed copy you've configured _is_ detected. Detection can fail when the app launches a differently-named child or wrapper process — add that process name under "Secondary executables to watch" in the profile editor — or when two different files share the same `.exe` name.

### Auto-updater isn't working

- Make sure your firewall/proxy allows `github.com` and `objects.githubusercontent.com`.
- If an update hangs, restart SimLauncher — it retries on the next launch.

---

## Building from source

You can build the installer yourself instead of trusting the published binary. It's a standard Electron + electron-vite project; you need [Node.js](https://nodejs.org/) 24 or newer.

```bash
git clone https://github.com/Stashpeak/SimLauncher
cd SimLauncher
npm install
npx install-electron   # Electron >=42 no longer downloads its binary via postinstall
npm run dist:win       # build a Windows installer into dist/
```

For the full development workflow — running in dev mode, the test/lint/typecheck gates, and how to add a game or utility — see [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Trust & transparency

- **The source is public** and licensed under **GPL-3.0** — you can read every line, the full commit history, issues, pull requests, and CI runs before trusting a binary.
- **You can build it yourself** from source (see above) instead of running the published installer.
- **Releases are built in CI** from tagged commits, and each release's notes link the issues and PRs behind every change.
- **Every release is verifiable**: each one ships `SHA256SUMS.txt` to confirm the installer's integrity and a CycloneDX `sbom.cdx.json` listing the full dependency inventory.
- **Development is AI-assisted** (Claude Code, Codex & Gemini) with human review on every change, disclosed openly in the commit history.
- **Security issues** should be reported privately — see [Security](#security).

---

## Security

Please **don't** open a public issue for security vulnerabilities. Report them privately via [GitHub Security Advisories](../../security/advisories/new). More detail is in [SECURITY.md](SECURITY.md).

---

## Support

Questions, setup help, or want to show your rig? Join the [SimLauncher Discord](https://discord.gg/37BPprjazF). For bugs and feature requests, open a [GitHub issue](../../issues).

If SimLauncher saves you time on race day, a small tip is appreciated: [paypal.me/shieldxx](https://paypal.me/shieldxx)

---

## License

GNU GPL v3. See [LICENSE](LICENSE).
