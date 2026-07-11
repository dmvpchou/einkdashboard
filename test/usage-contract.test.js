const assert = require("node:assert/strict");
const test = require("node:test");

const {
  codexResetCreditCount,
  normalizeClaudeApiUsage,
  summarizeClaudeUsage,
  summarizeGenericUsage,
  usagePresentation,
  withCodexResetCredits
} = require("../server");

test("Codex banked resets appear only when an official reset is available", () => {
  const usage = {
    display: {
      value: "12%",
      caption: "5h used",
      stats: [
        { label: "left", value: "88%" },
        { label: "reset", value: "04:18" },
        { label: "7d", value: "2%" }
      ]
    }
  };
  const official = { rate_limit_reset_credits: { available_count: 2 } };

  assert.equal(codexResetCreditCount(official), 2);
  assert.equal(withCodexResetCredits(usage, official).display.stats[3].value, "2");
  assert.equal(withCodexResetCredits(usage, { rate_limit_reset_credits: { available_count: 0 } }), usage);
});

test("Claude OAuth usage response maps to the shared rate-limit contract", () => {
  const status = normalizeClaudeApiUsage({
    five_hour: { utilization: 73.4, resets_at: "2026-07-11T08:59:59.000Z" },
    seven_day: { utilization: 41.2, resets_at: "2026-07-14T08:59:59.000Z" }
  });

  assert.equal(status.rateLimits.fiveHour.usedPercentage, 73.4);
  assert.equal(status.rateLimits.fiveHour.resetsAt, 1783760399);
  assert.equal(status.rateLimits.sevenDay.usedPercentage, 41.2);
});

test("Codex official usage keeps its glanceable display contract", () => {
  const usage = summarizeGenericUsage({
    line: "5h 12% used",
    detail: "88% left - resets 04:18 - 7d 2%",
    meter: { value: 12, label: "5h" },
    display: {
      value: "12%",
      caption: "5h used",
      stats: [
        { label: "left", value: "88%" },
        { label: "reset", value: "04:18" },
        { label: "7d", value: "2%" }
      ]
    },
    rateLimits: {
      primary: { usedPercent: 12 }
    }
  });

  const presentation = usagePresentation(usage);
  assert.equal(presentation.quality, "official");
  assert.equal(presentation.display.value, "12%");
  assert.equal(presentation.display.stats.length, 3);
  assert.deepEqual(presentation.meter, { value: 12, label: "5h" });
});

test("Claude rate limits produce official percentage and reset stats", () => {
  const usage = summarizeClaudeUsage({
    model: "Sonnet",
    rateLimits: {
      fiveHour: { usedPercentage: 73.4, resetsAt: 1783656000 },
      sevenDay: { usedPercentage: 41.2, resetsAt: 1784001600 }
    }
  });

  assert.equal(usage.quality, "official");
  assert.equal(usage.display.value, "73%");
  assert.equal(usage.display.caption, "5h used");
  assert.equal(usage.display.stats[0].value, "27%");
  assert.equal(usage.display.stats[2].value, "41%");
});

test("Missing usage has an explicit unavailable presentation", () => {
  assert.equal(summarizeClaudeUsage(null), null);
  assert.deepEqual(usagePresentation(null), {
    meter: null,
    display: null,
    quality: "unavailable"
  });
});
