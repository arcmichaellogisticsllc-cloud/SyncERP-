const fs = require("fs");
const path = require("path");
const { validateBackupData } = require("../server/backup-validation");

const file = process.argv[2];

if (!file) {
  console.error("Usage: npm run backup:verify -- path/to/backup.json");
  process.exit(1);
}

const fullPath = path.resolve(file);
let parsed;
try {
  parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
} catch (error) {
  console.error(`Backup is not valid JSON: ${error.message}`);
  process.exit(1);
}

const source = parsed.data && typeof parsed.data === "object" ? parsed.data : parsed;
const failures = validateBackupData(source);
if (failures.length) {
  console.error("Backup validation failed:");
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

const rowCounts = Object.fromEntries(
  Object.entries(source)
    .filter(([, value]) => Array.isArray(value))
    .map(([key, value]) => [key, value.length])
);

console.log(JSON.stringify({
  ok: true,
  file: fullPath,
  dataVersion: source.meta?.dataVersion || "",
  collections: Object.keys(rowCounts).length,
  rowCounts
}, null, 2));
