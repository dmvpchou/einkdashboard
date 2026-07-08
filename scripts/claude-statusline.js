const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const dataDir = path.join(root, "data");
const outPath = path.join(dataDir, "claude-status.json");
const sharedStatusDir = path.join(require("os").homedir(), ".ai-usage", "claude-status");

function readStdin() {
  return new Promise((resolve) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
  });
}

function percentage(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

function windowState(window) {
  if (!window) return null;
  return {
    usedPercentage: percentage(Number(window.used_percentage)),
    resetsAt: Number.isFinite(Number(window.resets_at)) ? Number(window.resets_at) : null
  };
}

function writeStatus(payload) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(payload, null, 2));

  const account = safeName(process.env.AI_USAGE_CLAUDE_ACCOUNT || process.env.CLAUDE_CONFIG_DIR || "default");
  fs.mkdirSync(sharedStatusDir, { recursive: true });
  fs.writeFileSync(
    path.join(sharedStatusDir, `${account}.json`),
    JSON.stringify(toSharedSnapshot(payload), null, 2)
  );
}

function safeName(value) {
  const base = path.basename(String(value || "default")).replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  return (base || "default").slice(0, 80);
}

function toSharedSnapshot(payload) {
  return {
    schema_version: 1,
    captured_at: Date.now() / 1000,
    account: safeName(process.env.AI_USAGE_CLAUDE_ACCOUNT || process.env.CLAUDE_CONFIG_DIR || "default"),
    session_id: payload.sessionId,
    version: payload.version,
    model: payload.model ? { display_name: payload.model } : null,
    rate_limits: {
      five_hour: fromWindowState(payload.rateLimits.fiveHour),
      seven_day: fromWindowState(payload.rateLimits.sevenDay)
    },
    context_window: payload.context,
    cost: payload.costUsd == null ? null : { total_cost_usd: payload.costUsd }
  };
}

function fromWindowState(window) {
  if (!window) return null;
  return {
    used_percentage: window.usedPercentage,
    resets_at: window.resetsAt
  };
}

function formatLine(payload) {
  const model = payload.model || "Claude";
  const fiveHour = payload.rateLimits.fiveHour?.usedPercentage;
  const week = payload.rateLimits.sevenDay?.usedPercentage;
  const pieces = [];
  if (fiveHour != null) pieces.push(`5h ${Math.round(fiveHour)}%`);
  if (week != null) pieces.push(`7d ${Math.round(week)}%`);
  return pieces.length ? `${model} | ${pieces.join(" ")}` : model;
}

(async () => {
  try {
    const raw = await readStdin();
    const data = raw ? JSON.parse(raw) : {};
    const payload = {
      updatedAt: new Date().toISOString(),
      model: data.model?.display_name || data.model?.id || null,
      sessionId: data.session_id || null,
      version: data.version || null,
      costUsd: Number.isFinite(Number(data.cost?.total_cost_usd)) ? Number(data.cost.total_cost_usd) : null,
      rateLimits: {
        fiveHour: windowState(data.rate_limits?.five_hour),
        sevenDay: windowState(data.rate_limits?.seven_day)
      },
      context: data.context_window
        ? {
            usedTokens: Number(data.context_window.used_tokens) || null,
            maxTokens: Number(data.context_window.max_tokens) || null,
            usedPercentage: percentage(Number(data.context_window.used_percentage))
          }
        : null
    };
    writeStatus(payload);
    process.stdout.write(formatLine(payload));
  } catch (error) {
    process.stdout.write("Claude status unavailable");
  }
})();
