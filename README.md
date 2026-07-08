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
  "refreshSeconds": 180,
  "claude": {
    "fiveHourTokenBudget": null
  }
}
```

Weather is fetched from Open-Meteo without an API key.

## Claude Code usage

Claude Code can feed real subscription usage into the dashboard through its
status line data. Configure Claude Code to run:

```powershell
node C:\Users\user\Documents\Codex\2026-07-05\boox-leaf2-pc-codex-claude-code\scripts\claude-statusline.js
```

The script writes `data/claude-status.json`, which the dashboard reads. It also
writes an AIBar-compatible snapshot under `~/.ai-usage/claude-status/`, so other
local usage tools can share the same Claude Code statusline feed. These JSON
files are ignored by Git because they are local usage state.

In Claude Code, use `/statusline` and choose a custom command, or add the same
command to your Claude Code settings. After Claude Code receives at least one
API response, the dashboard can show the 5-hour and 7-day rate-limit usage when
those fields are available.

When statusline data is not available, the dashboard falls back to local Claude
Code JSONL history under `~/.claude/projects` and shows a 5-hour token total
plus an estimated reset time. To estimate remaining tokens, set
`claude.fiveHourTokenBudget` in `config.json`.

## Codex usage

Codex usage is collected from local Codex state by `scripts/codex-usage-snapshot.py`.
The server runs this script before returning `/api/status`.

The script first scans `~/.codex/sessions/**/*.jsonl` for `token_count` events
and Codex `rate_limits` metadata. When rate-limit metadata is present, the
dashboard shows official local usage percentages and reset times. If session
rate-limit metadata is unavailable, it falls back to `%USERPROFILE%\.codex\logs_2.sqlite`
and shows a token-based estimate.

You can still create `data/codex-status.json` manually for testing:

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

## Reference

The Codex session-log and Claude statusline snapshot strategy was informed by
[neo-wabow/AIBar](https://github.com/neo-wabow/AIBar), adapted here for a
Windows + BOOX Leaf2 browser dashboard instead of a macOS menu bar app.
