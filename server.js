const fs = require("fs");
const http = require("http");
const https = require("https");
const os = require("os");
const path = require("path");
const { execFile } = require("child_process");

const root = __dirname;
const publicDir = path.join(root, "public");
const dataDir = path.join(root, "data");

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

function httpsJson(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "user-agent": "leaf2-usage-board" } }, (response) => {
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
        this.destroy(new Error("Weather request timed out"));
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
  const [claudeAuth, codexVersion] = await Promise.all([
    runCommand("claude", ["auth", "status", "--text"]),
    runCommand("codex", ["--version"])
  ]);

  await refreshCodexUsageSnapshot();

  const claudeStatus = readJsonIfFresh(path.join(dataDir, "claude-status.json"), 15 * 60 * 1000);
  const claudeUsage = claudeStatus
    ? summarizeClaudeUsage(claudeStatus.data)
    : summarizeClaudeLocalHistory();
  const codexStatus = readJsonIfFresh(path.join(dataDir, "codex-status.json"), 6 * 60 * 60 * 1000);
  const codexUsage = codexStatus ? summarizeGenericUsage(codexStatus.data) : null;

  const codexAuthPath = path.join(os.homedir(), ".codex", "auth.json");
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

  return {
    claude: {
      label: "Claude Code",
      state: claudeUsage ? "ready" : claudeAuth.ok ? "ready" : "unknown",
      line: claudeUsage?.line || (claudeAuth.ok ? "Claude Ready" : "Usage pending"),
      detail: claudeUsage?.detail || (claudeAuth.ok
        ? claudeAuth.stdout.split(/\r?\n/)[0] || "Signed in"
        : "Enable statusline bridge"),
      meter: claudeUsage?.meter || null
    },
    codex: {
      label: "Codex",
      state: codexUsage || codexVersion.ok || codexInstalled || codexHasAuth ? "ready" : "unknown",
      line: codexUsage?.line || codexLine,
      detail: codexUsage?.detail || codexDetail,
      meter: codexUsage?.meter || null
    }
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
    meter
  };
}

function summarizeClaudeUsage(status) {
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
    meter: {
      value: percent,
      label
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
    meter: hasBudget
      ? {
          value: Math.round(usedPercent),
          label: "5h"
        }
      : null
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
      tools
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

server.listen(config.port, "0.0.0.0", () => {
  const addresses = getLanAddresses();
  console.log(`Leaf2 board: http://localhost:${config.port}`);
  for (const address of addresses) {
    console.log(`LAN: http://${address}:${config.port}`);
  }
});
