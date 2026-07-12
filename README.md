# Leaf2 Usage Board

Local high-contrast dashboard for a BOOX Leaf2 or any E Ink browser.

> 簡約是細膩的極致
>
> Simplicity is the ultimate sophistication.

This is a glance display, not an analytics console. Keep only information that
can change an immediate decision: current time and weather, usage, remaining
quota, and reset time. If a value needs explanation before it is useful, remove
it or give it a clearer label.

## Run

```powershell
npm start
```

If the local `npm` shim is unavailable or points to a removed installation,
start the same server directly:

```powershell
node server.js
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

The server first reads the local Claude Code OAuth credential and requests the
same official 5-hour and 7-day utilization data used by Claude's usage view.
The credential stays on the PC and is never returned by the dashboard API or
written to logs. The result is cached briefly; if the request is unavailable,
the dashboard falls back to statusline data and then local token history.

The OAuth usage endpoint is used by Claude Code clients but is not currently
documented as a public Anthropic API, so the fallback remains important.

Claude Code can also feed subscription usage into the dashboard through its
status line data. Configure Claude Code to run:

```powershell
node "C:/repos/einkdashboard/scripts/claude-statusline.js"
```

Use forward slashes in the configured command on Windows. Claude Code may run
the command through Git Bash, where unquoted backslashes can be consumed.

The script writes `data/claude-status.json`, which the dashboard reads. It also
writes an AIBar-compatible snapshot under `~/.ai-usage/claude-status/`, so other
local usage tools can share the same Claude Code statusline feed. These JSON
files are ignored by Git because they are local usage state.

In Claude Code, use `/statusline` and choose a custom command, or add the same
command to your Claude Code settings. After Claude Code receives at least one
API response, the dashboard can show the 5-hour and 7-day rate-limit usage when
those fields are available.

On Windows, you can install the statusline command automatically:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install-claude-statusline.ps1
```

If Claude reports that `settings.json` is malformed, repair invalid JSON escape
sequences without removing existing settings:

```powershell
node .\scripts\repair-claude-settings.js --write
```

The repair command creates a timestamped backup beside `settings.json` before
writing a normalized, strictly valid JSON file.

Then restart Claude Code and send one message. Claude Code only emits
`rate_limits` after a response, so the dashboard will keep showing the local
token estimate until that first statusline snapshot is captured.

Run the installer again after pulling an updated repository so an older
backslash-based command is replaced.

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

The server also checks the official Codex usage status for banked referral
resets. When `rate_limit_reset_credits.available_count` is greater than zero,
the Codex card adds a small `可用重置` value. Zero, missing, or unavailable
values remain hidden so this optional reward does not add noise. The dashboard
never consumes a reset. Banked resets are promotional rewards and are separate
from purchased usage credits and the normal 5-hour reset time.

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

## BOOX and Windows notes

- Verify layout on the physical Leaf2. A desktop portrait viewport is useful,
  but it does not reproduce BOOX browser chrome, font metrics, or E Ink refresh.
- The BOOX browser can calculate `100vh` as the full screen, including browser
  chrome. The dashboard therefore synchronizes its height from
  `window.innerHeight` so the Claude card is not clipped below the fold.
- Color emoji can render on Windows but disappear on BOOX. Weather uses large
  Chinese text instead of depending on an emoji font.
- `adb reverse` is temporary. Run `adb devices` and then
  `adb reverse tcp:8765 tcp:8765` again after reconnecting USB or restarting ADB.

To avoid repairing the connection manually after every reboot, install the
per-user Windows startup task once:

```powershell
npm run install:autostart
```

The task starts the dashboard when needed, waits for an authorized Android
device, and restores `tcp:8765` every time USB or ADB reconnects. After this is
installed, do not also run `npm start`; the scheduled task owns the background
server. Logs are written under `data/`.
- BOOX may retain old CSS and JavaScript. Reload the page; if necessary, append
  a temporary query string such as `/?v=2`.
- Claude Code may execute a Windows statusline command through Git Bash. Keep
  forward slashes in the JSON command path and use the repair script if an
  escaped backslash makes `settings.json` invalid.
- An official percentage and a local token estimate are different data
  qualities. The interface labels estimates explicitly and never represents
  confidence with an unexplained icon or square.

For future changes: read the dashboard from arm's length, capture an actual
Leaf2 screenshot over ADB, and remove any element that competes with the usage
percentage or reset time without helping the next decision.

## Development

Run the current verification suite with:

```powershell
node --check server.js
node --check public/app.js
node --test
git diff --check
```

Commit work follows [maylogger/lazy-commit](https://github.com/maylogger/lazy-commit).
The repository-level rules are recorded in `AGENTS.md`: group by intent, use
atomic commits and Conventional Commits, and write commit descriptions in
Traditional Chinese.

## Conversation notices

Each usage card reads recent local Codex or Claude Code session JSONL files and
shows its own conversations that need a reply, were interrupted, or completed
during the last 12 hours. Only the tool name, project folder, state, and update
time reach the dashboard API; prompts and responses are never returned to the
browser.

Each card shows its most recently updated notice beside the usage percentage.
Additional items collapse into a small `+N` count so the tool association is
immediate and the usage number remains the primary information.

Actively running sessions stay hidden. Each tool card uses the most recently
updated completed or explicitly attention-needed session as its visible project;
older notices are represented only by the `+N` count.
