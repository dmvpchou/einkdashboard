const weatherCodes = new Map([
  [0, "Clear"],
  [1, "Mainly clear"],
  [2, "Partly cloudy"],
  [3, "Cloudy"],
  [45, "Fog"],
  [48, "Fog"],
  [51, "Light drizzle"],
  [53, "Drizzle"],
  [55, "Heavy drizzle"],
  [61, "Light rain"],
  [63, "Rain"],
  [65, "Heavy rain"],
  [71, "Light snow"],
  [73, "Snow"],
  [75, "Heavy snow"],
  [80, "Rain showers"],
  [81, "Rain showers"],
  [82, "Heavy showers"],
  [95, "Thunderstorm"]
]);

let refreshSeconds = 180;

function text(id, value) {
  document.getElementById(id).textContent = value;
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
  text(
    "secondLine",
    new Intl.DateTimeFormat("zh-TW", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(now)
  );
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

function setDot(id, state) {
  const dot = document.getElementById(id);
  dot.className = `state-dot ${state === "ready" ? "ready" : "warn"}`;
}

function updateToolCard(prefix, tool) {
  const display = tool.display || {};
  text(`${prefix}Value`, display.value || tool.line || "--");
  text(`${prefix}Caption`, display.caption || "");
  text(`${prefix}Note`, tool.detail || "");
  updateStats(prefix, display.stats || []);
  updateMeter(prefix, tool.meter);
  setDot(`${prefix}Dot`, tool.state);
}

function updateStats(prefix, stats) {
  const container = document.getElementById(`${prefix}Stats`);
  if (!container) return;
  container.textContent = "";
  for (const item of stats.slice(0, 3)) {
    const stat = document.createElement("div");
    const label = document.createElement("span");
    const value = document.createElement("strong");
    label.textContent = item.label || "";
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
    const daily = data.daily || {};
    const max = daily.temperature_2m_max && daily.temperature_2m_max[0];
    const min = daily.temperature_2m_min && daily.temperature_2m_min[0];
    const pop = daily.precipitation_probability_max && daily.precipitation_probability_max[0];
    text("weatherPlace", data.label || "--");
    if (data.offline) {
      text("temperature", "--");
      text("weatherText", "Weather offline");
      text("weatherRange", "No cache");
      text("weatherWind", "PC network");
      return;
    }
    text("temperature", Number.isFinite(current.temperature_2m) ? `${Math.round(current.temperature_2m)}°` : "--");
    text("weatherText", data.stale ? "Cached weather" : weatherCodes.get(current.weather_code) || "Weather");
    text("weatherRange", Number.isFinite(max) && Number.isFinite(min) ? `${Math.round(min)}-${Math.round(max)}°C` : "--");
    text("weatherWind", Number.isFinite(current.wind_speed_10m) ? `${Math.round(current.wind_speed_10m)} km/h` : `Rain ${pop || 0}%`);
  } catch (error) {
    text("weatherText", "Weather unavailable");
    text("weatherRange", error.message);
  }
}

function scheduleRefresh() {
  refreshStatus();
  refreshWeather();
  window.setTimeout(scheduleRefresh, refreshSeconds * 1000);
}

updateClock();
window.setInterval(updateClock, 1000);
scheduleRefresh();
