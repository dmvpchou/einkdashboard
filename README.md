# Leaf2 Usage Board

Local high-contrast dashboard for a BOOX Leaf2 or any E Ink browser.

## Run

```powershell
npm start
```

Open the LAN URL printed by the server on the Leaf2 browser.

## Configure

Copy `config.example.json` to `config.json` and adjust the location or port.

```json
{
  "port": 8765,
  "location": {
    "label": "Taipei",
    "latitude": 25.033,
    "longitude": 121.5654,
    "timezone": "Asia/Taipei"
  },
  "refreshSeconds": 180
}
```

Weather is fetched from Open-Meteo without an API key.

## Claude Code usage

Claude Code can feed real subscription usage into the dashboard through its
status line data. Configure Claude Code to run:

```powershell
node C:\Users\user\Documents\Codex\2026-07-05\boox-leaf2-pc-codex-claude-code\scripts\claude-statusline.js
```

The script writes `data/claude-status.json`, which the dashboard reads. The
JSON file is ignored by Git because it is local usage state.

In Claude Code, use `/statusline` and choose a custom command, or add the same
command to your Claude Code settings. After Claude Code receives at least one
API response, the dashboard can show the 5-hour and 7-day rate-limit usage when
those fields are available.

## Codex usage

Codex usage can be shown when `data/codex-status.json` exists. This is a manual
or integration target for now because Codex `/usage` is an interactive TUI
command, not a statusline-style JSON feed.

Copy `data/codex-status.example.json` to `data/codex-status.json` and update it
from a Codex `/usage` snapshot or a future Analytics API integration:

```json
{
  "line": "7d 18% used",
  "detail": "resets 18:00 - manual /usage snapshot",
  "meter": {
    "value": 18,
    "label": "7d"
  }
}
```

`data/codex-status.json` is ignored by Git because it is local usage state.
