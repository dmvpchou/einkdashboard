const weatherLabels = new Map([
  [0, "晴"],
  [1, "晴朗"],
  [2, "多雲"],
  [3, "陰"],
  [45, "霧"],
  [48, "霧"],
  [51, "細雨"],
  [53, "細雨"],
  [55, "細雨"],
  [61, "小雨"],
  [63, "雨"],
  [65, "大雨"],
  [71, "小雪"],
  [73, "雪"],
  [75, "大雪"],
  [80, "陣雨"],
  [81, "陣雨"],
  [82, "大雨"],
  [95, "雷雨"]
]);

function syncViewportHeight() {
  document.documentElement.style.setProperty("--viewport-height", `${window.innerHeight}px`);
}

const rotatingQuotes = [
  { text: "簡約是細膩的極致", language: "zh" },
  { text: "Simplicity is the ultimate sophistication.", language: "en" }
];

let refreshSeconds = 180;

function text(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function formatDate(now) {
  return new Intl.DateTimeFormat("zh-TW", {
    weekday: "long",
    month: "long",
    day: "numeric"
  }).format(now);
}

function updateClock() {
  const now = new Date();
  text("dateLine", formatDate(now));
  text(
    "clock",
    new Intl.DateTimeFormat("zh-TW", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(now)
  );
  updateQuote(now);
}

function updateQuote(now) {
  const quote = document.getElementById("quoteText");
  if (!quote) return;
  const index = Math.floor(now.getTime() / (5 * 60 * 1000)) % rotatingQuotes.length;
  const selected = rotatingQuotes[index];
  quote.textContent = selected.text;
  quote.className = `quote-panel quote-${selected.language}`;
  quote.lang = selected.language === "zh" ? "zh-Hant" : "en";
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function updateToolCard(prefix, tool) {
  const display = tool.display || {};
  const stats = display.stats || [];
  const reset = stats.find((item) => String(item.label || "").toLowerCase() === "reset");
  text(`${prefix}Value`, display.value || tool.line || "--");
  text(`${prefix}Caption`, localizeCaption(display.caption || "", tool.quality));
  text(`${prefix}Reset`, formatResetValue(reset?.value));
  updateStats(prefix, stats.filter((item) => item !== reset));
  updateMeter(prefix, tool.meter);
}

function formatResetValue(value) {
  const normalized = String(value || "").trim();
  if (!normalized || /unknown/i.test(normalized)) return "--";
  return normalized.replace(/^resets\s+/i, "");
}

function localizeCaption(caption, quality) {
  const normalized = caption.trim().toLowerCase();
  if (normalized === "5h used" && quality === "official") return "5 小時已用 · 官方";
  if (normalized === "5h used") return "5 小時已用";
  if (normalized === "5h used est.") return "5 小時估算";
  if (normalized === "7d used") return "7 天已用";
  return caption;
}

function localizeStatLabel(label) {
  return {
    left: "剩餘",
    reset: "重置",
    used: "已用",
    "7d": "7 天"
  }[String(label || "").toLowerCase()] || label || "";
}

function updateStats(prefix, stats) {
  const container = document.getElementById(`${prefix}Stats`);
  if (!container) return;
  container.textContent = "";
  const visibleStats = stats
    .filter((item) => item.value != null && String(item.value).trim() !== "" && String(item.value).trim() !== "--")
    .slice(0, 3);
  container.style.gridTemplateColumns = `repeat(${Math.max(1, visibleStats.length)}, minmax(0, 1fr))`;
  for (const item of visibleStats) {
    const stat = document.createElement("div");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = localizeStatLabel(item.label);
    value.textContent = item.value || "";
    stat.append(label, value);
    container.appendChild(stat);
  }
}

function updateMeter(prefix, meter) {
  const meterElement = document.getElementById(`${prefix}Meter`);
  const fill = document.getElementById(`${prefix}MeterFill`);
  if (!meterElement || !fill) return;
  if (!meter || !Number.isFinite(Number(meter.value))) {
    meterElement.hidden = true;
    fill.style.width = "0%";
    return;
  }
  const value = Math.max(0, Math.min(100, Number(meter.value)));
  meterElement.hidden = false;
  fill.style.width = `${value}%`;
}

async function refreshStatus() {
  try {
    const data = await fetchJson("/api/status");
    refreshSeconds = data.refreshSeconds || refreshSeconds;
    updateToolCard("codex", data.tools.codex);
    updateToolCard("claude", data.tools.claude);
    text("updatedAt", `Updated ${new Intl.DateTimeFormat("zh-TW", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    }).format(new Date())}`);
    if (data.addresses && data.addresses.length) {
      const host = window.location.port ? `${data.addresses[0]}:${window.location.port}` : data.addresses[0];
      text("lanHint", host);
    }
  } catch (error) {
    text("updatedAt", `Status unavailable: ${error.message}`);
  }
}

async function refreshWeather() {
  try {
    const data = await fetchJson("/api/weather");
    const current = data.current || {};
    if (data.offline) {
      text("temperature", "--");
      text("weatherIcon", "?");
      text("weatherDescription", "Weather unavailable");
      return;
    }
    const description = weatherLabels.get(current.weather_code) || "天氣";
    text("temperature", Number.isFinite(current.temperature_2m) ? `${Math.round(current.temperature_2m)}\u00B0` : "--");
    text("weatherIcon", description);
    text("weatherDescription", description);
  } catch (error) {
    text("temperature", "--");
    text("weatherIcon", "?");
    text("weatherDescription", "Weather unavailable");
  }
}

function scheduleRefresh() {
  refreshStatus();
  refreshWeather();
  window.setTimeout(scheduleRefresh, refreshSeconds * 1000);
}

syncViewportHeight();
window.addEventListener("resize", syncViewportHeight);
window.addEventListener("orientationchange", syncViewportHeight);
updateClock();
window.setInterval(updateClock, 1000);
scheduleRefresh();
