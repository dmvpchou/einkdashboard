const assert = require("node:assert/strict");
const test = require("node:test");

const {
  summarizeClaudeUsage,
  summarizeGenericUsage,
  usagePresentation
} = require("../server");

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
  assert.deepEqual(usagePresentation(null), {
    meter: null,
    display: null,
    quality: "unavailable"
  });
});
