# Blue Protocol Combat Tracker (BPSR-PSO)

A desktop overlay for Blue Protocol: Star Resonance to visualize DPS/HPS, tanking, and skill breakdowns in real time, plus a persistent daily/weekly checklist.

## Project Lineage & Credits

- Forked from: https://github.com/Chase-Simmons/BPSR-PSO/
- Translation resources: https://github.com/DannyDog/StarResonanceDps (fork of https://github.com/anying1073/StarResonanceDps), which also inspired some features
- Checklist inspiration and reference: [Prydwen – Blue Protocol Daily Checklist](https://www.prydwen.gg/blue-protocol/tools/daily-checklist/)

This app is a standalone companion overlay. It does not modify game files. Network data is analyzed while in transit to compute and display combat statistics.

## Features

- Always-on-top frameless overlay with click-through toggle
- Real-time DPS/HPS/tanking views and sortable rankings
- Per-user skill breakdown window with charts and detailed stats
- Persistent daily/weekly checklist window with color-coded items and icons
  - “Reset Daily/Weekly” with confirmation dialog
  - State saved to `checklist.json` and restored on app launch
- Hotkeys and opacity controls (saved across sessions)
- Lightweight embedded HTTP server + WebSocket for live updates

## Screens & Windows

- Main overlay window (frameless, transparent background)
- Skill Breakdown window (solid background, custom header)
- Checklist window (solid background, custom header)

## Getting Started

### Prerequisites

- Node.js and npm: https://nodejs.org
- Windows users: Npcap (installer shipped in `resources/npcap-1.83.exe`). Select “Install Npcap in WinPcap API-compatible Mode”.

### Install

```bash
git clone https://github.com/Chase-Simmons/BPSR-PSO.git
cd BPSR-PSO
npm install
```

If you’re on Windows, install Npcap from `resources/npcap-1.83.exe` before starting the app.

### Run (Development)

```bash
npm start
```

This boots the Electron app and the embedded server. The overlay will load automatically once the server is ready.

### Build (Distributables)

We use Electron Forge.

```bash
# Package app (no installer)
npm run package

# Make platform-specific installers/archives
npm run make
```

Artifacts are generated under `out/` per your platform and maker configuration (see `package.json`). For Windows, a Squirrel installer is created; for macOS/Linux, zipped archives are produced by default.

## Configuration & Persistence

- Window geometry, click-through mode, and hotkeys are persisted in `windowConfig.json`.
- Checklist selections are saved in `checklist.json`.
- App settings (e.g., out-of-combat clear seconds) are served under `/api/settings` and stored in `src/settings.json` on first write.

## Keyboard Shortcuts

- Click-through toggle (default: `F6`)
- Toggle window (default: `F7`)
- Refresh/Clear (default: `F5`)

You can change hotkeys in the Settings panel. Changes persist.

## Development Notes

- Static assets are served from `src/public`. Checklist icons are expected in `src/public/assets/checklist/` and referenced by filename.
- The main process, server, and renderer are split under `src/`.
  - Main entry: `src/index.js`
  - Server: `src/server.js` (serves `/src/public` and `/api` routes)
  - Renderer UI: `src/public/`
  - Windows: `src/client/*.js`

## Acknowledgements & Attributions

- Fork source: https://github.com/Chase-Simmons/BPSR-PSO/
- Translation files and inspiration: https://github.com/DannyDog/StarResonanceDps and https://github.com/anying1073/StarResonanceDps
- Checklist inspiration and reference: [Prydwen – Blue Protocol Daily Checklist](https://www.prydwen.gg/blue-protocol/tools/daily-checklist/)

If you are an author/owner of referenced content and have attribution or license concerns, please open an issue and we will promptly address it.

## License

This project is licensed under the MIT License. See `LICENSE.txt` for details.

## Disclaimer

This software is provided “as is,” without warranty of any kind. You are solely responsible for complying with the game’s Terms of Service and any applicable laws or rules when using third-party tools.
