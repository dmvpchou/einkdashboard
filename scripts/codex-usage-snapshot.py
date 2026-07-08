import json
import sqlite3
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path.home() / ".codex" / "logs_2.sqlite"
SESSION_ROOT = Path.home() / ".codex" / "sessions"
OUT_PATH = ROOT / "data" / "codex-status.json"


def empty_window():
    return {
        "entries": 0,
        "input": 0,
        "cached": 0,
        "output": 0,
        "reasoning": 0,
        "total": 0,
        "latest_ts": None,
        "models": set(),
    }


def add_usage(target, ts, model, usage):
    input_tokens = int(usage.get("input_tokens") or 0)
    output_tokens = int(usage.get("output_tokens") or 0)
    cache_creation = int(usage.get("cache_creation_input_tokens") or 0)
    cache_read = int(usage.get("cache_read_input_tokens") or 0)
    reasoning_tokens = int(usage.get("reasoning_output_tokens") or 0)
    input_details = usage.get("input_tokens_details") or {}
    output_details = usage.get("output_tokens_details") or {}
    cached_tokens = cache_creation + cache_read + int(input_details.get("cached_tokens") or 0)
    reasoning_tokens += int(output_details.get("reasoning_tokens") or 0)
    total_tokens = int(usage.get("total_tokens") or input_tokens + output_tokens + cache_creation + cache_read)

    target["entries"] += 1
    target["input"] += input_tokens
    target["cached"] += cached_tokens
    target["output"] += output_tokens
    target["reasoning"] += reasoning_tokens
    target["total"] += total_tokens
    target["latest_ts"] = ts if target["latest_ts"] is None else max(target["latest_ts"], ts)
    if model:
        target["models"].add(model)


def fmt_tokens(value):
    value = int(value or 0)
    if value >= 1_000_000:
        return f"{value / 1_000_000:.1f}M tok"
    if value >= 1_000:
        return f"{round(value / 1_000)}K tok"
    return f"{value} tok"


def parse_timestamp(value):
    if not value:
        return None
    try:
        normalized = str(value).replace("Z", "+00:00")
        return int(datetime.fromisoformat(normalized).timestamp())
    except Exception:
        return None


def collect_session_events(now, five_hour, seven_day):
    if not SESSION_ROOT.exists():
        return None

    week_cutoff = now - 7 * 24 * 60 * 60
    latest_rate_limits = None
    latest_rate_ts = None
    events = 0

    for file_path in SESSION_ROOT.rglob("*.jsonl"):
        try:
            if int(file_path.stat().st_mtime) < week_cutoff:
                continue
            lines = file_path.read_text(encoding="utf-8", errors="ignore").splitlines()
        except Exception:
            continue

        for line in lines:
            if "\"token_count\"" not in line:
                continue
            try:
                event = json.loads(line)
            except Exception:
                continue

            payload = event.get("payload") or {}
            if payload.get("type") != "token_count":
                continue

            ts = parse_timestamp(event.get("timestamp"))
            if not ts:
                continue

            info = payload.get("info") or {}
            usage = info.get("last_token_usage") or {}
            model = info.get("model") or payload.get("model")
            age = now - ts

            if age <= 5 * 60 * 60:
                add_usage(five_hour, ts, model, usage)
            if age <= 7 * 24 * 60 * 60:
                add_usage(seven_day, ts, model, usage)

            events += 1
            rate_limits = payload.get("rate_limits")
            if rate_limits and (latest_rate_ts is None or ts > latest_rate_ts):
                latest_rate_limits = rate_limits
                latest_rate_ts = ts

    if events == 0:
        return None

    return {
        "source": "local Codex session logs",
        "rateLimits": normalize_rate_limits(latest_rate_limits),
    }


def collect_sqlite_events(now, five_hour, seven_day):
    if not DB_PATH.exists():
        return None

    events = 0

    con = sqlite3.connect(DB_PATH)
    try:
        rows = con.execute(
            """
            select ts, feedback_log_body
            from logs
            where feedback_log_body like 'Received message {%'
              and feedback_log_body like '%response.completed%'
            order by ts desc
            """
        ).fetchall()
    finally:
        con.close()

    for ts, body in rows:
        if "Received message " not in body:
            continue
        raw = body.split("Received message ", 1)[1]
        try:
            event = json.loads(raw)
        except Exception:
            continue
        if event.get("type") != "response.completed":
            continue
        response = event.get("response") or {}
        usage = response.get("usage") or {}
        if not usage:
            continue
        age = now - int(ts)
        if age <= 5 * 60 * 60:
            add_usage(five_hour, int(ts), response.get("model"), usage)
        if age <= 7 * 24 * 60 * 60:
            add_usage(seven_day, int(ts), response.get("model"), usage)
        events += 1

    if events == 0:
        return None

    return {
        "source": "local Codex sqlite logs",
        "rateLimits": None,
    }


def normalize_rate_limits(rate_limits):
    if not isinstance(rate_limits, dict):
        return None

    return {
        "planType": rate_limits.get("plan_type"),
        "primary": normalize_rate_window(rate_limits.get("primary")),
        "secondary": normalize_rate_window(rate_limits.get("secondary")),
    }


def normalize_rate_window(window):
    if not isinstance(window, dict):
        return None
    used = to_float(window.get("used_percent"))
    reset = to_int(window.get("resets_at"))
    minutes = to_int(window.get("window_minutes"))
    if used is None and reset is None and minutes is None:
        return None
    return {
        "usedPercent": used,
        "remainingPercent": None if used is None else max(0, min(100, 100 - used)),
        "resetsAt": reset,
        "windowMinutes": minutes,
        "label": label_for_window(minutes),
    }


def label_for_window(minutes):
    if minutes == 5 * 60:
        return "5h"
    if minutes == 7 * 24 * 60:
        return "7d"
    if minutes:
        return f"{minutes}m"
    return "limit"


def to_float(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def to_int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def format_reset(epoch_seconds):
    if not epoch_seconds:
        return "reset --"
    try:
        return datetime.fromtimestamp(epoch_seconds).strftime("%H:%M")
    except Exception:
        return "reset --"


def usage_payload_from_rate_limit(source, five_hour, seven_day, rate_limits):
    windows = []
    if rate_limits:
        windows = [rate_limits.get("primary"), rate_limits.get("secondary")]
    windows = [window for window in windows if window and window.get("usedPercent") is not None]
    if not windows:
        return None

    preferred = windows[0]
    used = max(0, min(100, preferred["usedPercent"]))
    left = max(0, min(100, preferred["remainingPercent"]))
    label = preferred.get("label") or "limit"
    reset = format_reset(preferred.get("resetsAt"))
    secondary = windows[1] if len(windows) > 1 else None
    secondary_text = None
    if secondary and secondary.get("usedPercent") is not None:
        secondary_text = f"{secondary.get('label') or 'limit'} {round(secondary['usedPercent'])}%"

    detail_parts = [f"{round(left)}% left", f"resets {reset}"]
    if secondary_text:
        detail_parts.append(secondary_text)
    detail_parts.append("official local metadata")

    return {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "line": f"{label} {round(used)}% used",
        "detail": " - ".join(detail_parts),
        "source": source,
        "window": label,
        "meter": {
            "value": round(used),
            "label": label,
        },
        "display": {
            "value": f"{round(used)}%",
            "caption": f"{label} used",
            "stats": [
                {"label": "left", "value": f"{round(left)}%"},
                {"label": "reset", "value": reset},
                {"label": secondary.get("label") if secondary else "tokens", "value": secondary_text.split(" ", 1)[1] if secondary_text else fmt_tokens(five_hour["total"] or seven_day["total"])},
            ],
        },
        "rateLimits": rate_limits,
        "tokens": token_windows(five_hour, seven_day),
    }


def token_windows(five_hour, seven_day):
    return {
        "fiveHour": {k: v for k, v in five_hour.items() if k != "models"},
        "sevenDay": {k: v for k, v in seven_day.items() if k != "models"},
    }


def main():
    now = int(time.time())
    five_hour = empty_window()
    seven_day = empty_window()

    collected = collect_session_events(now, five_hour, seven_day)
    if not collected:
        collected = collect_sqlite_events(now, five_hour, seven_day)

    if not collected or (not five_hour["entries"] and not seven_day["entries"]):
        return 1

    rate_payload = usage_payload_from_rate_limit(
        collected["source"],
        five_hour,
        seven_day,
        collected.get("rateLimits"),
    )
    if rate_payload:
        payload = rate_payload
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        OUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
        if "--quiet" not in sys.argv:
            print(json.dumps(payload, indent=2))
        return 0

    preferred = five_hour if five_hour["entries"] else seven_day
    label = "5h" if five_hour["entries"] else "7d"
    detail = [
        f"{fmt_tokens(preferred['total'])} used",
        f"cached {fmt_tokens(preferred['cached'])}",
    ]
    if seven_day["entries"]:
        detail.append(f"7d {fmt_tokens(seven_day['total'])}")
    if preferred["models"]:
        detail.append(", ".join(sorted(preferred["models"])))

    payload = {
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "line": f"{label} usage",
        "detail": " - ".join(detail) + " - est.",
        "source": collected["source"],
        "window": label,
        "display": {
            "value": fmt_tokens(preferred["total"]),
            "caption": f"{label} used est.",
            "stats": [
                {"label": "cached", "value": fmt_tokens(preferred["cached"])},
                {"label": "output", "value": fmt_tokens(preferred["output"])},
                {"label": "model", "value": ", ".join(sorted(preferred["models"])) if preferred["models"] else "--"},
            ],
        },
        "tokens": token_windows(five_hour, seven_day),
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    if "--quiet" not in sys.argv:
        print(json.dumps(payload, indent=2))
    return 0


raise SystemExit(main())
