const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const root = __dirname;
const publicDir = path.join(root, "public");
const dataDir = path.join(root, "data");
const claudeCredentialsPath = path.join(os.homedir(), ".claude", ".credentials.json");
const claudeUsageUrl = "https://api.anthropic.com/api/oauth/usage";
const claudeUsageCache = { data: null, fetchedAt: 0 };
const codexAuthPath = path.join(os.homedir(), ".codex", "auth.json");
const codexUsageUrl = "https://chatgpt.com/backend-api/wham/usage";
const codexUsageCache = { data: null, fetchedAt: 0 };
const conversationNoticeCache = { data: [], fetchedAt: 0 };
const conversationNoticeMaxAgeMs = 12 * 60 * 60 * 1000;

const defaultConfig = {
  port: 8765,
  location: {
    label: "Taipei",
    latitude: 25.033,
    longitude: 121.5654,
    timezone: "Asia/Taipei"
  },
  refreshSeconds: 60
};

function loadConfig() {
  const configPath = path.join(root, "config.json");
  if (!fs.existsSync(configPath)) return defaultConfig;
  try {
    const userConfig = JSON.parse(fs.readFileSync(configPath, "utf8"));
    return {
      ...defaultConfig,
      ...userConfig,
      location: { ...defaultConfig.location, ...(userConfig.location || {}) }
    };
  } catch (error) {
    console.warn(`Could not read config.json: ${error.message}`);
    return defaultConfig;
  }
}

const config = loadConfig();

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(payload);
}

function readJsonIfFresh(filePath, maxAgeMs) {
  try {
    const stat = fs.statSync(filePath);
    const ageMs = Date.now() - stat.mtimeMs;
    if (ageMs > maxAgeMs) return null;
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return { data, ageMs };
  } catch {
    return null;
  }
}

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function sendFile(res, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  };
  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, {
      "content-type": types[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  });
}

function httpsJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": "leaf2-usage-board", ...(options.headers || {}) } }, (response) => {
        let data = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          data += chunk;
        });
        response.on("end", () => {
          if (response.statusCode < 200 || response.statusCode >= 300) {
            reject(new Error(`HTTP ${response.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(data));
          } catch (error) {
            reject(error);
          }
        });
      })
      .on("error", reject)
      .setTimeout(8000, function onTimeout() {
        this.destroy(new Error("HTTPS request timed out"));
      });
  });
}

function runCommand(command, args) {
  return new Promise((resolve) => {
    try {
      const child = execFile(command, args, { timeout: 5000, windowsHide: true }, (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout || "").trim(),
          stderr: String(stderr || "").trim(),
          code: error && typeof error.code === "number" ? error.code : 0
        });
      });
      child.on("error", (error) => {
        resolve({
          ok: false,
          stdout: "",
          stderr: error.message,
          code: 0
        });
      });
    } catch (error) {
      resolve({
        ok: false,
        stdout: "",
        stderr: error.message,
        code: 0
      });
    }
  });
}

function getLanAddresses() {
  return Object.values(os.networkInterfaces())
    .flat()
    .filter((item) => item && item.family === "IPv4" && !item.internal)
    .map((item) => item.address);
}

async function getToolStatus() {
  const [claudeAuth, codexVersion, claudeOfficialStatus, codexOfficialStatus] = await Promise.all([
    runCommand("claude", ["auth", "status", "--text"]),
    runCommand("codex", ["--version"]),
    fetchClaudeOfficialUsage(),
    fetchCodexOfficialUsage()
  ]);

  await refreshCodexUsageSnapshot();

  const claudeStatus = readClaudeStatusSnapshot();
  const claudeUsage = summarizeClaudeUsage(claudeOfficialStatus)
    || (claudeStatus ? summarizeClaudeUsage(claudeStatus.data) : null)
    || summarizeClaudeLocalHistory();
  const codexStatus = readJsonIfFresh(path.join(dataDir, "codex-status.json"), 6 * 60 * 60 * 1000);
  const codexUsage = withCodexResetCredits(
    codexStatus ? summarizeGenericUsage(codexStatus.data) : null,
    codexOfficialStatus
  );

  const codexHasAuth = fs.existsSync(codexAuthPath);
  const codexInstalled = findExecutableOnPath("codex") || findExecutableOnPath("codex.exe");
  const codexLine = codexVersion.ok
    ? "Codex Ready"
    : codexHasAuth
      ? "Codex Ready"
      : codexInstalled
      ? "Codex installed"
      : "Codex CLI not found";
  const codexDetail = codexVersion.ok
    ? codexVersion.stdout.split(/\r?\n/)[0]
    : codexHasAuth
      ? "Auth cache found; usage unavailable"
      : codexInstalled
        ? "CLI found; auth cache not visible"
        : "No local auth cache found";

  const claudeState = claudeUsage?.quality === "official"
    ? "ready"
    : claudeUsage
      ? "estimated"
      : claudeAuth.ok
        ? "waiting"
        : "unknown";
  const codexState = codexUsage?.quality === "official"
    ? "ready"
    : codexUsage
      ? "estimated"
      : codexVersion.ok || codexInstalled || codexHasAuth
        ? "waiting"
        : "unknown";

  return {
    claude: {
      label: "Claude Code",
      state: claudeState,
      line: claudeUsage?.line || (claudeAuth.ok ? "Claude Ready" : "Usage pending"),
      detail: claudeUsage?.detail || (claudeAuth.ok
        ? claudeAuth.stdout.split(/\r?\n/)[0] || "Signed in"
        : "Enable statusline bridge"),
      ...usagePresentation(claudeUsage)
    },
    codex: {
      label: "Codex",
      state: codexState,
      line: codexUsage?.line || codexLine,
      detail: codexUsage?.detail || codexDetail,
      ...usagePresentation(codexUsage)
    }
  };
}

function isLikelyQuestion(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  return /[?？]\s*$/.test(text)
    || /(?:請(?:選擇|告訴|提供|確認|回覆)|需要你|是否要|要不要|would you|please (?:choose|tell|provide|confirm))/i.test(text);
}

function messageText(message) {
  const content = message?.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((item) => item && (item.type === "text" || item.type === "output_text" || item.type === "input_text"))
    .map((item) => item.text || "")
    .join("\n");
}

function projectLabel(cwd, fallback) {
  const normalized = String(cwd || "").replace(/[\\/]+$/, "");
  return normalized ? path.basename(normalized) : fallback;
}

function classifyCodexRecords(records, metadata = {}) {
  let state = "idle";
  let lastAssistantText = "";
  let pendingInteractiveCall = false;
  let cwd = metadata.cwd || "";

  for (const record of records) {
    if (record.type === "session_meta") cwd = record.payload?.cwd || cwd;
    if (record.type === "turn_context") cwd = record.payload?.cwd || cwd;
    if (record.type === "event_msg" && record.payload?.type === "task_started") {
      state = "running";
      lastAssistantText = "";
      pendingInteractiveCall = false;
    }
    if (record.type === "response_item" && record.payload?.type === "message" && record.payload?.role === "assistant") {
      lastAssistantText = messageText(record.payload);
    }
    if (record.type === "response_item" && /(?:function_call|custom_tool_call)$/.test(record.payload?.type || "")) {
      const name = String(record.payload?.name || "");
      pendingInteractiveCall = /request_user_input|ask_user|request_permission/i.test(name);
    }
    if (record.type === "response_item" && /(?:function_call_output|custom_tool_call_output)$/.test(record.payload?.type || "")) {
      pendingInteractiveCall = false;
    }
    if (record.type === "event_msg" && record.payload?.type === "turn_aborted") state = "interrupted";
    if (record.type === "event_msg" && record.payload?.type === "task_complete") {
      state = isLikelyQuestion(lastAssistantText) ? "input" : "complete";
    }
  }

  if (state === "running" && pendingInteractiveCall) state = "input";
  if (!["input", "complete", "interrupted"].includes(state)) return null;
  return { state, tool: "Codex", project: projectLabel(cwd, "Codex task") };
}

function classifyClaudeRecords(records, metadata = {}) {
  let lastAssistant = null;
  let cwd = metadata.cwd || "";
  for (const record of records) {
    cwd = record.cwd || cwd;
    if (record.type === "assistant" && record.message?.role === "assistant") lastAssistant = record;
  }
  if (!lastAssistant) return null;

  const stopReason = lastAssistant.message?.stop_reason;
  const text = messageText(lastAssistant.message);
  let state = null;
  if (stopReason === "end_turn") state = isLikelyQuestion(text) ? "input" : "complete";
  if (!state) return null;
  return { state, tool: "Claude", project: projectLabel(cwd, "Claude task") };
}

function sortConversationNotices(notices) {
  const priority = { input: 0, interrupted: 1, complete: 2 };
  return [...notices].sort((a, b) => {
    const timeDifference = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
    return timeDifference || priority[a.state] - priority[b.state];
  });
}

function readJsonlSlice(filePath, maxBytes = 512 * 1024, fromEnd = true) {
  try {
    const stat = fs.statSync(filePath);
    const size = Math.min(stat.size, maxBytes);
    const start = fromEnd ? Math.max(0, stat.size - size) : 0;
    const buffer = Buffer.alloc(size);
    const descriptor = fs.openSync(filePath, "r");
    try {
      fs.readSync(descriptor, buffer, 0, size, start);
    } finally {
      fs.closeSync(descriptor);
    }
    let source = buffer.toString("utf8");
    if (fromEnd && start > 0) source = source.slice(source.indexOf("\n") + 1);
    return source.split(/\r?\n/).filter(Boolean).flatMap((line) => {
      try {
        return [JSON.parse(line)];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

function recentJsonlFiles(rootPath, now, limit = 30) {
  const results = [];
  const visit = (directory) => {
    let entries = [];
    try {
      entries = fs.readdirSync(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(fullPath);
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      try {
        const stat = fs.statSync(fullPath);
        if (now - stat.mtimeMs <= conversationNoticeMaxAgeMs) {
          results.push({ path: fullPath, modifiedAt: stat.mtimeMs });
        }
      } catch {
        // Ignore sessions that disappear during the scan.
      }
    }
  };
  visit(rootPath);
  return results.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit);
}

function getConversationNotices() {
  const now = Date.now();
  if (now - conversationNoticeCache.fetchedAt < 30 * 1000) return conversationNoticeCache.data;

  const notices = [];
  const codexRoot = path.join(os.homedir(), ".codex", "sessions");
  for (const file of recentJsonlFiles(codexRoot, now)) {
    const head = readJsonlSlice(file.path, 64 * 1024, false);
    const tail = readJsonlSlice(file.path);
    const meta = head.find((record) => record.type === "session_meta")?.payload || {};
    const notice = classifyCodexRecords(tail, meta);
    if (notice) notices.push({ ...notice, updatedAt: new Date(file.modifiedAt).toISOString() });
  }

  const claudeRoot = path.join(os.homedir(), ".claude", "projects");
  for (const file of recentJsonlFiles(claudeRoot, now)) {
    const tail = readJsonlSlice(file.path);
    const notice = classifyClaudeRecords(tail, { ageMs: now - file.modifiedAt });
    if (notice) notices.push({ ...notice, updatedAt: new Date(file.modifiedAt).toISOString() });
  }

  conversationNoticeCache.data = sortConversationNotices(notices).slice(0, 12);
  conversationNoticeCache.fetchedAt = now;
  return conversationNoticeCache.data;
}

async function fetchCodexOfficialUsage() {
  const now = Date.now();
  if (codexUsageCache.data && now - codexUsageCache.fetchedAt < 60 * 1000) {
    return codexUsageCache.data;
  }

  try {
    const auth = JSON.parse(fs.readFileSync(codexAuthPath, "utf8"));
    const accessToken = auth.tokens?.access_token;
    const accountId = auth.tokens?.account_id;
    if (!accessToken) return null;

    const headers = {
      accept: "application/json",
      authorization: `Bearer ${accessToken}`
    };
    if (accountId) headers["chatgpt-account-id"] = accountId;
    const response = await httpsJson(codexUsageUrl, { headers });
    codexUsageCache.data = response;
    codexUsageCache.fetchedAt = now;
    return response;
  } catch {
    return now - codexUsageCache.fetchedAt < 10 * 60 * 1000
      ? codexUsageCache.data
      : null;
  }
}

function codexResetCreditCount(status) {
  const value = status?.rate_limit_reset_credits?.available_count;
  const count = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return Number.isInteger(count) && count >= 0 ? count : null;
}

function withCodexResetCredits(usage, status) {
  const count = codexResetCreditCount(status);
  if (!usage || !usage.display || !count) return usage;
  return {
    ...usage,
    display: {
      ...usage.display,
      stats: [
        ...(usage.display.stats || []).filter((item) => item.label !== "resets"),
        { label: "resets", value: String(count) }
      ]
    }
  };
}

async function fetchClaudeOfficialUsage() {
  const now = Date.now();
  if (claudeUsageCache.data && now - claudeUsageCache.fetchedAt < 60 * 1000) {
    return claudeUsageCache.data;
  }

  try {
    const credentials = JSON.parse(fs.readFileSync(claudeCredentialsPath, "utf8"));
    const oauth = credentials.claudeAiOauth;
    if (!oauth?.accessToken || Number(oauth.expiresAt) <= now) return null;

    const response = await httpsJson(claudeUsageUrl, {
      headers: {
        accept: "application/json",
        authorization: `Bearer ${oauth.accessToken}`,
        "anthropic-beta": "oauth-2025-04-20"
      }
    });
    const normalized = normalizeClaudeApiUsage(response);
    if (!normalized) return null;
    claudeUsageCache.data = normalized;
    claudeUsageCache.fetchedAt = now;
    return normalized;
  } catch {
    return now - claudeUsageCache.fetchedAt < 10 * 60 * 1000
      ? claudeUsageCache.data
      : null;
  }
}

function normalizeClaudeApiUsage(status) {
  if (!status || typeof status !== "object") return null;
  const fiveHour = normalizeClaudeApiWindow(status.five_hour);
  const sevenDay = normalizeClaudeApiWindow(status.seven_day);
  if (!fiveHour && !sevenDay) return null;
  return { rateLimits: { fiveHour, sevenDay } };
}

function normalizeClaudeApiWindow(window) {
  if (!window) return null;
  const usedPercentage = Number(window.utilization);
  const resetsAtMs = Date.parse(window.resets_at);
  return {
    usedPercentage: Number.isFinite(usedPercentage) ? usedPercentage : null,
    resetsAt: Number.isFinite(resetsAtMs) ? Math.floor(resetsAtMs / 1000) : null
  };
}

function usagePresentation(usage) {
  return {
    meter: usage?.meter || null,
    display: usage?.display || null,
    quality: usage?.quality || "unavailable"
  };
}

async function refreshCodexUsageSnapshot() {
  const scriptPath = path.join(root, "scripts", "codex-usage-snapshot.py");
  if (!fs.existsSync(scriptPath)) return;
  const result = await runCommand("python", [scriptPath, "--quiet"]);
  if (!result.ok) {
    await runCommand("py", [scriptPath, "--quiet"]);
  }
}

function summarizeGenericUsage(status) {
  if (!status || typeof status !== "object") return null;
  const meterValue = Number(status.meter?.value ?? status.usedPercentage);
  const meter = Number.isFinite(meterValue)
    ? {
        value: Math.max(0, Math.min(100, meterValue)),
        label: status.meter?.label || status.window || "usage"
      }
    : null;
  const rounded = meter ? Math.round(meter.value) : null;
  const line = status.line || (rounded != null ? `${meter.label} ${rounded}% used` : null);
  if (!line) return null;
  return {
    line,
    detail: status.detail || status.source || "manual usage snapshot",
    meter,
    quality: status.rateLimits?.primary?.usedPercent != null ? "official" : "estimated",
    display: status.display || {
      value: line.replace(/^5h\s+/i, "").replace(/^7d\s+/i, ""),
      caption: meter?.label ? `${meter.label} estimate` : "usage",
      stats: status.stats || []
    }
  };
}

function readClaudeStatusSnapshot() {
  const local = readJsonIfFresh(path.join(dataDir, "claude-status.json"), 15 * 60 * 1000);
  if (local) {
    return {
      ...local,
      data: normalizeClaudeStatus(local.data)
    };
  }

  const sharedRoot = path.join(os.homedir(), ".ai-usage", "claude-status");
  const files = listFiles(sharedRoot, ".json")
    .map((filePath) => {
      try {
        const stat = fs.statSync(filePath);
        return { filePath, mtimeMs: stat.mtimeMs, ageMs: Date.now() - stat.mtimeMs };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((item) => item.ageMs <= 30 * 60 * 1000)
    .sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const item of files) {
    try {
      return {
        data: normalizeClaudeStatus(JSON.parse(fs.readFileSync(item.filePath, "utf8"))),
        ageMs: item.ageMs
      };
    } catch {
      // Try the next shared snapshot.
    }
  }

  return null;
}

function normalizeClaudeStatus(status) {
  if (!status || typeof status !== "object") return status;
  if (status.rateLimits) return status;

  const fiveHour = status.rate_limits?.five_hour;
  const sevenDay = status.rate_limits?.seven_day;
  return {
    updatedAt: status.captured_at ? new Date(Number(status.captured_at) * 1000).toISOString() : null,
    model: status.model?.display_name || status.model?.id || null,
    sessionId: status.session_id || null,
    version: status.version || null,
    costUsd: Number.isFinite(Number(status.cost?.total_cost_usd)) ? Number(status.cost.total_cost_usd) : null,
    rateLimits: {
      fiveHour: normalizeClaudeWindow(fiveHour),
      sevenDay: normalizeClaudeWindow(sevenDay)
    },
    context: status.context_window || null
  };
}

function normalizeClaudeWindow(window) {
  if (!window) return null;
  return {
    usedPercentage: Number.isFinite(Number(window.used_percentage)) ? Number(window.used_percentage) : null,
    resetsAt: Number.isFinite(Number(window.resets_at)) ? Number(window.resets_at) : null
  };
}

function summarizeClaudeUsage(status) {
  if (!status || typeof status !== "object") return null;
  const fiveHour = status.rateLimits?.fiveHour;
  const sevenDay = status.rateLimits?.sevenDay;
  const preferred = fiveHour?.usedPercentage != null ? fiveHour : sevenDay;
  if (!preferred?.usedPercentage && preferred?.usedPercentage !== 0) return null;

  const label = fiveHour?.usedPercentage != null ? "5h" : "7d";
  const percent = Math.round(preferred.usedPercentage);
  const leftPercent = Math.max(0, 100 - percent);
  const reset = preferred.resetsAt ? formatReset(preferred.resetsAt) : "reset unknown";
  const weekText = sevenDay?.usedPercentage != null ? `7d ${Math.round(sevenDay.usedPercentage)}%` : null;
  return {
    line: `${label} ${percent}% used`,
    detail: [`${leftPercent}% left`, reset, weekText, status.model].filter(Boolean).join(" - "),
    quality: "official",
    meter: {
      value: percent,
      label
    },
    display: {
      value: `${percent}%`,
      caption: `${label} used`,
      stats: [
        { label: "left", value: `${leftPercent}%` },
        { label: "reset", value: reset.replace(/^resets\s+/i, "") },
        { label: "7d", value: sevenDay?.usedPercentage != null ? `${Math.round(sevenDay.usedPercentage)}%` : "--" }
      ]
    }
  };
}

function summarizeClaudeLocalHistory() {
  const rootPath = path.join(os.homedir(), ".claude", "projects");
  const files = listFiles(rootPath, ".jsonl");
  if (!files.length) return null;

  const now = Date.now();
  const fiveHourMs = 5 * 60 * 60 * 1000;
  const sevenDayMs = 7 * 24 * 60 * 60 * 1000;
  const fiveHour = emptyUsageWindow();
  const sevenDay = emptyUsageWindow();
  let oldestInFiveHour = null;

  for (const file of files) {
    let lines;
    try {
      lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
    } catch {
      continue;
    }
    for (const line of lines) {
      if (!line.trim()) continue;
      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }
      const timestamp = Date.parse(entry.timestamp || entry.created_at || "");
      if (Number.isNaN(timestamp)) continue;
      const usage = entry.message?.usage || entry.usage;
      if (!usage) continue;

      if (now - timestamp <= fiveHourMs) {
        addUsage(fiveHour, usage);
        oldestInFiveHour = oldestInFiveHour == null ? timestamp : Math.min(oldestInFiveHour, timestamp);
      }
      if (now - timestamp <= sevenDayMs) {
        addUsage(sevenDay, usage);
      }
    }
  }

  if (!fiveHour.entries && !sevenDay.entries) return null;

  const budget = Number(config.claude?.fiveHourTokenBudget);
  const hasBudget = Number.isFinite(budget) && budget > 0;
  const usedPercent = hasBudget ? Math.min(100, (fiveHour.total / budget) * 100) : null;
  const remaining = hasBudget ? Math.max(0, budget - fiveHour.total) : null;
  const resetText = oldestInFiveHour ? formatResetMs(oldestInFiveHour + fiveHourMs) : "reset unknown";

  return {
    line: hasBudget ? `5h ${Math.round(usedPercent)}% used` : "5h usage",
    detail: hasBudget
      ? `${formatTokens(remaining)} left - ${formatTokens(fiveHour.total)} used - ${resetText} - est.`
      : `${formatTokens(fiveHour.total)} used - ${resetText} - est.`,
    quality: "estimated",
    meter: hasBudget
      ? {
          value: Math.round(usedPercent),
          label: "5h"
        }
      : null,
    display: hasBudget
      ? {
          value: `${Math.round(usedPercent)}%`,
          caption: "5h used est.",
          stats: [
            { label: "left", value: formatTokens(remaining) },
            { label: "used", value: formatTokens(fiveHour.total) },
            { label: "reset", value: resetText.replace(/^resets\s+/i, "") }
          ]
        }
      : {
          value: formatTokens(fiveHour.total),
          caption: "5h used est.",
          stats: [
            { label: "left", value: "--" },
            { label: "used", value: formatTokens(fiveHour.total) },
            { label: "reset", value: resetText.replace(/^resets\s+/i, "") }
          ]
        }
  };
}

function emptyUsageWindow() {
  return {
    entries: 0,
    input: 0,
    output: 0,
    cacheCreate: 0,
    cacheRead: 0,
    total: 0
  };
}

function addUsage(target, usage) {
  target.entries += 1;
  target.input += Number(usage.input_tokens) || 0;
  target.output += Number(usage.output_tokens) || 0;
  target.cacheCreate += Number(usage.cache_creation_input_tokens) || 0;
  target.cacheRead += Number(usage.cache_read_input_tokens) || 0;
  target.total +=
    (Number(usage.input_tokens) || 0) +
    (Number(usage.output_tokens) || 0) +
    (Number(usage.cache_creation_input_tokens) || 0) +
    (Number(usage.cache_read_input_tokens) || 0);
}

function listFiles(rootPath, extension) {
  const files = [];
  try {
    for (const entry of fs.readdirSync(rootPath, { withFileTypes: true })) {
      const entryPath = path.join(rootPath, entry.name);
      if (entry.isDirectory()) {
        files.push(...listFiles(entryPath, extension));
      } else if (entry.name.endsWith(extension)) {
        files.push(entryPath);
      }
    }
  } catch {
    return files;
  }
  return files;
}

function formatReset(epochSeconds) {
  const date = new Date(epochSeconds * 1000);
  if (Number.isNaN(date.getTime())) return "reset unknown";
  return `resets ${date.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })}`;
}

function formatResetMs(epochMs) {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return "reset unknown";
  return `resets ${date.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  })}`;
}

function formatTokens(value) {
  const tokens = Math.max(0, Math.round(Number(value) || 0));
  if (tokens >= 1000000) return `${(tokens / 1000000).toFixed(1)}M tok`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K tok`;
  return `${tokens} tok`;
}

function findExecutableOnPath(name) {
  const pathExts = process.platform === "win32"
    ? (process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM").split(";")
    : [""];
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const names = path.extname(name) ? [name] : pathExts.map((ext) => `${name}${ext.toLowerCase()}`);
  for (const dir of dirs) {
    for (const candidate of names) {
      const fullPath = path.join(dir, candidate);
      try {
        fs.accessSync(fullPath, fs.constants.F_OK);
        return fullPath;
      } catch {
        // Keep scanning.
      }
    }
  }
  return "";
}

async function getWeather() {
  const cachePath = path.join(dataDir, "weather-cache.json");
  const location = config.location;
  const params = new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    timezone: location.timezone,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m",
    daily: "temperature_2m_max,temperature_2m_min,precipitation_probability_max"
  });
  const url = `https://api.open-meteo.com/v1/forecast?${params.toString()}`;
  const data = await httpsJson(url);
  const payload = {
    label: location.label,
    timezone: location.timezone,
    current: data.current,
    daily: data.daily
  };
  writeJson(cachePath, payload);
  return payload;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (url.pathname === "/api/status") {
    const tools = await getToolStatus();
    sendJson(res, 200, {
      now: new Date().toISOString(),
      refreshSeconds: config.refreshSeconds,
      addresses: getLanAddresses(),
      tools,
      notices: getConversationNotices()
    });
    return;
  }

  if (url.pathname === "/api/weather") {
    try {
      sendJson(res, 200, await getWeather());
    } catch (error) {
      const cached = readJsonIfFresh(path.join(dataDir, "weather-cache.json"), 6 * 60 * 60 * 1000);
      if (cached) {
        sendJson(res, 200, { ...cached.data, stale: true });
        return;
      }
      sendJson(res, 200, {
        label: config.location.label,
        offline: true,
        error: error.message
      });
    }
    return;
  }

  const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
  const filePath = path.normalize(path.join(publicDir, requested));
  if (!filePath.startsWith(publicDir)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }
  sendFile(res, filePath);
});

if (require.main === module) {
  server.listen(config.port, "0.0.0.0", () => {
    const addresses = getLanAddresses();
    console.log(`Leaf2 board: http://localhost:${config.port}`);
    for (const address of addresses) {
      console.log(`LAN: http://${address}:${config.port}`);
    }
  });
}

module.exports = {
  classifyClaudeRecords,
  classifyCodexRecords,
  codexResetCreditCount,
  fetchCodexOfficialUsage,
  fetchClaudeOfficialUsage,
  normalizeClaudeApiUsage,
  normalizeClaudeStatus,
  sortConversationNotices,
  summarizeClaudeUsage,
  summarizeGenericUsage,
  usagePresentation,
  withCodexResetCredits
};
