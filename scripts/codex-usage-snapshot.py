import json
import sqlite3
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DB_PATH = Path.home() / ".codex" / "logs_2.sqlite"
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
    total_tokens = int(usage.get("total_tokens") or input_tokens + output_tokens)
    input_details = usage.get("input_tokens_details") or {}
    output_details = usage.get("output_tokens_details") or {}

    target["entries"] += 1
    target["input"] += input_tokens
    target["cached"] += int(input_details.get("cached_tokens") or 0)
    target["output"] += output_tokens
    target["reasoning"] += int(output_details.get("reasoning_tokens") or 0)
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


def main():
    if not DB_PATH.exists():
        return 1

    now = int(__import__("time").time())
    five_hour = empty_window()
    seven_day = empty_window()

    con = sqlite3.connect(DB_PATH)
    rows = con.execute(
        """
        select ts, feedback_log_body
        from logs
        where feedback_log_body like 'Received message {%'
          and feedback_log_body like '%response.completed%'
        order by ts desc
        """
    ).fetchall()

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

    if not five_hour["entries"] and not seven_day["entries"]:
        return 1

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
        "updatedAt": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
        "line": f"{label} usage",
        "detail": " - ".join(detail) + " - est.",
        "source": "local Codex logs",
        "window": label,
        "tokens": {
            "fiveHour": {k: v for k, v in five_hour.items() if k != "models"},
            "sevenDay": {k: v for k, v in seven_day.items() if k != "models"},
        },
    }

    OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    OUT_PATH.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    if "--quiet" not in sys.argv:
        print(json.dumps(payload, indent=2))
    return 0


raise SystemExit(main())
