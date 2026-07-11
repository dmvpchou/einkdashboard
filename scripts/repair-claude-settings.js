const fs = require("fs");
const os = require("os");
const path = require("path");

function repairInvalidJsonEscapes(input) {
  let output = "";
  let inString = false;
  let repairs = 0;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (!inString) {
      output += char;
      if (char === '"') inString = true;
      continue;
    }

    if (char === '"') {
      output += char;
      inString = false;
      continue;
    }

    if (char !== "\\") {
      output += char;
      continue;
    }

    const next = input[index + 1];
    if ('"\\/bfnrt'.includes(next)) {
      output += `\\${next}`;
      index += 1;
      continue;
    }

    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(input.slice(index + 2, index + 6))) {
      output += input.slice(index, index + 6);
      index += 5;
      continue;
    }

    output += "\\\\";
    repairs += 1;
  }

  return { output, repairs };
}

function parseArguments(argv) {
  const args = { write: false, file: path.join(os.homedir(), ".claude", "settings.json") };
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--write") args.write = true;
    if (argv[index] === "--file" && argv[index + 1]) {
      args.file = path.resolve(argv[index + 1]);
      index += 1;
    }
  }
  return args;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\..+$/, "").replace("T", "-");
}

function repairFile(filePath, write) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  try {
    JSON.parse(raw);
    return { changed: false, repairs: 0, message: "Settings are already valid JSON." };
  } catch {
    // Repair only invalid escape sequences, then require strict JSON parsing.
  }

  const repaired = repairInvalidJsonEscapes(raw);
  const parsed = JSON.parse(repaired.output);
  const normalized = `${JSON.stringify(parsed, null, 2)}\n`;
  if (!write) {
    return {
      changed: true,
      repairs: repaired.repairs,
      message: `Found ${repaired.repairs} invalid JSON escape sequence(s). Run again with --write.`
    };
  }

  const backupPath = `${filePath}.backup-${timestamp()}`;
  const temporaryPath = `${filePath}.tmp-${process.pid}`;
  fs.copyFileSync(filePath, backupPath, fs.constants.COPYFILE_EXCL);
  fs.writeFileSync(temporaryPath, normalized, "utf8");
  fs.renameSync(temporaryPath, filePath);
  return {
    changed: true,
    repairs: repaired.repairs,
    backupPath,
    message: `Repaired ${repaired.repairs} invalid JSON escape sequence(s).`
  };
}

if (require.main === module) {
  try {
    const args = parseArguments(process.argv.slice(2));
    const result = repairFile(args.file, args.write);
    console.log(result.message);
    if (result.backupPath) console.log(`Backup: ${result.backupPath}`);
  } catch (error) {
    console.error(`Could not repair Claude settings: ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  repairFile,
  repairInvalidJsonEscapes
};
