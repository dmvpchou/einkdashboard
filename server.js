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
  refreshSeconds: 180
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

  const claudeStatus = readJsonIfFresh(path.join(dataDir, "claude-status.json"), 15 * 60 * 1000);
  const claudeUsage = claudeStatus ? summarizeClaudeUsage(claudeStatus.data) : null;

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
      state: codexVersion.ok || codexInstalled || codexHasAuth ? "ready" : "unknown",
      line: codexLine,
      detail: codexDetail,
      meter: null
    }
  };
}

function summarizeClaudeUsage(status) {
  const fiveHour = status.rateLimits?.fiveHour;
  const sevenDay = status.rateLimits?.sevenDay;
  const preferred = fiveHour?.usedPercentage != null ? fiveHour : sevenDay;
  if (!preferred?.usedPercentage && preferred?.usedPercentage !== 0) return null;

  const label = fiveHour?.usedPercentage != null ? "5h" : "7d";
  const percent = Math.round(preferred.usedPercentage);
  const reset = preferred.resetsAt ? formatReset(preferred.resetsAt) : "reset unknown";
  const weekText = sevenDay?.usedPercentage != null ? `7d ${Math.round(sevenDay.usedPercentage)}%` : null;
  return {
    line: `${label} ${percent}% used`,
    detail: [reset, weekText, status.model].filter(Boolean).join(" · "),
    meter: {
      value: percent,
      label
    }
  };
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
