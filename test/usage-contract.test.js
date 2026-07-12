const assert = require("node:assert/strict");
const test = require("node:test");

const {
  classifyClaudeRecords,
  classifyCodexRecords,
  codexResetCreditCount,
  isClaudeSessionRunning,
  isCodexSessionRunning,
  normalizeClaudeApiUsage,
  sortConversationNotices,
  summarizeClaudeUsage,
  summarizeGenericUsage,
  usagePresentation,
  visibleConversationNotices,
  withCodexResetCredits
} = require("../server");

test("Codex completed and blocking turns become glanceable notices", () => {
  const base = [
    { type: "session_meta", payload: { cwd: "C:\\repos\\einkdashboard" } },
    { type: "event_msg", payload: { type: "task_started" } }
  ];
  const completed = classifyCodexRecords([
    ...base,
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "完成了" }] } },
    { type: "event_msg", payload: { type: "task_complete" } }
  ]);
  const waiting = classifyCodexRecords([
    ...base,
    { type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "請確認要繼續嗎？" }] } },
    { type: "event_msg", payload: { type: "task_complete" } }
  ]);

  assert.deepEqual(completed, { state: "complete", tool: "Codex", project: "einkdashboard" });
  assert.equal(waiting.state, "input");
  assert.equal(classifyCodexRecords(base), null);
  assert.equal(isCodexSessionRunning(base), true);
});

test("Claude end turns become notices while tool turns stay hidden", () => {
  const complete = classifyClaudeRecords([{
    type: "assistant",
    cwd: "C:\\repos\\cascara",
    message: { role: "assistant", stop_reason: "end_turn", content: [{ type: "text", text: "Done" }] }
  }], { ageMs: 1000 });
  const running = classifyClaudeRecords([{
    type: "assistant",
    cwd: "C:\\repos\\cascara",
    message: { role: "assistant", stop_reason: "tool_use", content: [] }
  }], { ageMs: 11 * 60 * 1000 });

  assert.equal(complete.state, "complete");
  assert.equal(running, null);
  assert.equal(isClaudeSessionRunning([{
    type: "assistant",
    message: { role: "assistant", stop_reason: "tool_use", content: [] }
  }]), true);
});

test("Conversation notices prefer the most recently updated session", () => {
  const notices = sortConversationNotices([
    { state: "interrupted", tool: "Codex", project: "older-project", updatedAt: "2026-07-12T08:00:00.000Z" },
    { state: "complete", tool: "Codex", project: "latest-project", updatedAt: "2026-07-12T09:00:00.000Z" }
  ]);

  assert.equal(notices[0].project, "latest-project");
});

test("A running tool hides older notices from the same tool", () => {
  const notices = visibleConversationNotices([
    { state: "complete", tool: "Claude", project: "cascara", updatedAt: "2026-07-12T09:00:00.000Z" },
    { state: "complete", tool: "Codex", project: "einkdashboard", updatedAt: "2026-07-12T08:00:00.000Z" }
  ], new Set(["Claude"]));

  assert.deepEqual(notices.map((notice) => notice.project), ["einkdashboard"]);
});

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
