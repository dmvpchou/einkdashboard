const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  repairFile,
  repairInvalidJsonEscapes
} = require("../scripts/repair-claude-settings");

test("repairs invalid escapes while preserving valid JSON escapes", () => {
  const source = String.raw`{"permissions":{"allow":["PowerShell(\(test\))","C:\\Users\\user"]}}`;
  const repaired = repairInvalidJsonEscapes(source);
  const parsed = JSON.parse(repaired.output);

  assert.equal(repaired.repairs, 2);
  assert.equal(parsed.permissions.allow[0], String.raw`PowerShell(\(test\))`);
  assert.equal(parsed.permissions.allow[1], String.raw`C:\Users\user`);
});

test("writes a valid normalized file and creates a backup", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "claude-settings-test-"));
  const filePath = path.join(directory, "settings.json");
  const source = String.raw`{"permissions":{"allow":["PowerShell(\(test\))"]},"statusLine":{"command":"node C:/tool.js"}}`;
  fs.writeFileSync(filePath, source);

  try {
    const result = repairFile(filePath, true);
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.equal(result.repairs, 2);
    assert.equal(parsed.statusLine.command, "node C:/tool.js");
    assert.equal(fs.readFileSync(result.backupPath, "utf8"), source);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
