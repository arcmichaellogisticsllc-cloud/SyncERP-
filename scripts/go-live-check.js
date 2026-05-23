const required = {
  NODE_ENV: "production",
  PRODUCTION_MODE: "true",
  DEMO_AUTH: "false",
  ALLOW_INSECURE_HTTP: "false",
  ALLOW_JSON_PRODUCTION: "false",
  ALLOW_ADMIN_RESTORE: "false",
  DEBUG_ERRORS: "false"
};

const failures = [];

for (const [key, expected] of Object.entries(required)) {
  if (process.env[key] !== expected) failures.push(`${key} must be ${expected}`);
}

if (!process.env.AUTH_SECRET || process.env.AUTH_SECRET.length < 32 || process.env.AUTH_SECRET === "syncerp-local-dev-secret-change-me") {
  failures.push("AUTH_SECRET must be a strong non-default secret.");
}

if (!process.env.DATA_DRIVER || process.env.DATA_DRIVER === "json") {
  failures.push("DATA_DRIVER must be a production database driver, not json.");
}

if (!process.env.MYSQL_HOST && !process.env.MYSQL_SOCKET) {
  failures.push("MYSQL_HOST or MYSQL_SOCKET must be configured.");
}

if (!process.env.MYSQL_USER || !process.env.MYSQL_PASSWORD) {
  failures.push("MYSQL_USER and MYSQL_PASSWORD must be configured through deployment secrets.");
}

if (failures.length) {
  console.error("Go-live configuration failed:");
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log("Go-live configuration checks passed.");
