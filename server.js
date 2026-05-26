const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");
const { canServePublicPath, publicContentType } = require("./server/static-policy");
const { validateBackupData } = require("./server/backup-validation");
const { validateUploadMetadata } = require("./server/upload-policy");
const { emitWorkflowEvent } = require("./server/workflow-engine");
const { dispatchOperationalEvent } = require("./server/event-bus");

loadEnvFile();
const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const DB_PATH = process.env.DB_PATH || path.join(ROOT, "data", "db.json");
const DATA_DRIVER = process.env.DATA_DRIVER || "json";
const MYSQL_DATABASE = process.env.MYSQL_DATABASE || "syncerp";
const MYSQL_SOCKET = Object.prototype.hasOwnProperty.call(process.env, "MYSQL_SOCKET") ? process.env.MYSQL_SOCKET : "/Applications/MAMP/tmp/mysql/mysql.sock";
const MYSQL_HOST = process.env.MYSQL_HOST || "127.0.0.1";
const MYSQL_PORT = process.env.MYSQL_PORT || "3306";
const MYSQL_USER = process.env.MYSQL_USER || "root";
const MYSQL_PASSWORD = process.env.MYSQL_PASSWORD || "";
const MYSQL_BIN = process.env.MYSQL_BIN || "/Applications/MAMP/Library/bin/mysql80/bin/mysql";
const AUTH_SECRET = process.env.AUTH_SECRET || "syncerp-local-dev-secret-change-me";
const DEMO_AUTH_ENABLED = process.env.DEMO_AUTH === "true";
const PRODUCTION_MODE = process.env.NODE_ENV === "production" || process.env.PRODUCTION_MODE === "true";
const DEFAULT_AUTH_SECRET = "syncerp-local-dev-secret-change-me";
const DEBUG_ERRORS = process.env.DEBUG_ERRORS === "true";
const ALLOW_INSECURE_HTTP = process.env.ALLOW_INSECURE_HTTP === "true";
const ALLOW_JSON_PRODUCTION = process.env.ALLOW_JSON_PRODUCTION === "true";
const ALLOW_ADMIN_RESTORE = process.env.ALLOW_ADMIN_RESTORE === "true";
const TRUST_PROXY = process.env.TRUST_PROXY === "true";
const LOG_LEVEL = process.env.LOG_LEVEL || (PRODUCTION_MODE ? "info" : "warn");
const LOGIN_RATE_LIMIT_WINDOW_MS = Number(process.env.LOGIN_RATE_LIMIT_WINDOW_MS || 15 * 60 * 1000);
const LOGIN_RATE_LIMIT_MAX = Number(process.env.LOGIN_RATE_LIMIT_MAX || 8);
const loginAttempts = new Map();

const collections = new Set([
  "auditLog",
  "projects",
  "tasks",
  "dailies",
  "people",
  "equipment",
  "invoices",
  "invoiceSubmissions",
  "safety",
  "documents",
  "fieldEvidence",
  "photoEvidence",
  "contractRules",
  "siteSurveys",
  "obstacles",
  "qcCloseouts",
  "retainageLedger",
  "costBlockers",
  "squanScores",
  "crews",
  "roles",
  "costCodes",
  "unitPrices",
  "priceSheetItems",
  "squanImports",
  "squanProductionLines",
  "squanMapFeatures",
  "productionDailies",
  "productionLines",
  "contractorPayables",
  "contractorAgreements",
  "contractorSettlements",
  "contractorSettlementDeductions",
  "contractorSettlementPayments",
  "techWorkEntries",
  "billingLedger",
  "quantityReconciliation",
  "projectUnits",
  "dailyProduction",
  "dailyLabor",
  "timeEntries",
  "dailyEquipment",
  "dailyMaterials",
  "billingReadiness",
  "formSubmissions",
  "packetLocks",
  "alertControls",
  "cashReceipts",
  "cashDepositBatches",
  "collectionSubmissions",
  "collectionDecisionPackets",
  "billingTaskCloseouts",
  "packageSnapshots",
  "offlineSyncQueue",
  "fieldUploadQueue",
  "customerContactLog",
  "notifications",
  "passwordResetTokens",
  "uploadIntake",
  "workflowEvents",
  "workflowInstances",
  "workflowTransitions"
]);

function loadEnvFile() {
  const file = path.join(__dirname, ".env");
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, "utf8").split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const index = trimmed.indexOf("=");
    if (index === -1) return;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (key && process.env[key] === undefined) process.env[key] = value;
  });
}

function mysqlArgs(database = MYSQL_DATABASE) {
  const args = ["--batch", "--raw", "--skip-column-names", "--default-character-set=utf8mb4"];
  if (MYSQL_SOCKET) args.push(`--socket=${MYSQL_SOCKET}`);
  else {
    args.push(`--host=${MYSQL_HOST}`);
    args.push(`--port=${MYSQL_PORT}`);
  }
  args.push(`--user=${MYSQL_USER}`);
  if (MYSQL_PASSWORD) args.push(`--password=${MYSQL_PASSWORD}`);
  if (database) args.push(database);
  return args;
}

function runMysql(sql, database = MYSQL_DATABASE) {
  const result = spawnSync(MYSQL_BIN, mysqlArgs(database), {
    input: sql,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024
  });
  if (result.status !== 0) {
    const detail = result.stderr || result.stdout || "Unknown MySQL error";
    throw new Error(`MySQL command failed: ${detail.trim()}`);
  }
  return result.stdout;
}

function sqlString(value) {
  if (value === null || value === undefined || value === "") return "NULL";
  return `'${String(value).replace(/\\/g, "\\\\").replace(/'/g, "''")}'`;
}

function sqlJson(value) {
  return `CAST(${sqlString(JSON.stringify(value))} AS JSON)`;
}

function sqlDate(value) {
  if (!value) return "NULL";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "NULL";
  return sqlString(date.toISOString().slice(0, 19).replace("T", " "));
}

function recordId(collection, record, index) {
  return record.id || record.key || record.email || record.code || record.invoice || `${collection}-${index + 1}`;
}

function statusValue(record) {
  return record.status || record.reviewStatus || record.billingStatus || record.paymentStatus || record.approvalStatus || "";
}

function ownerValue(record) {
  return record.owner || record.by || record.foreman || record.contractor || record.employee || record.submittedBy || "";
}

function projectValue(record) {
  return record.project || record.projectId || record.ntp || record.map || "";
}

function readDb() {
  if (DATA_DRIVER === "mysql") return readMysqlDb();
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  if (DATA_DRIVER === "mysql") return writeMysqlDb(db);
  fs.writeFileSync(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);
}

function readMysqlDb() {
  const db = {};
  collections.forEach(collection => {
    db[collection] = [];
  });
  db.auditLog = [];
  const appStateRows = runMysql("SELECT state_key, JSON_UNQUOTE(JSON_EXTRACT(payload, '$')) FROM app_state ORDER BY state_key;");
  appStateRows.trim().split(/\r?\n/).filter(Boolean).forEach(line => {
    const [key, payload] = line.split("\t");
    if (key && payload) db[key] = JSON.parse(payload);
  });
  const recordRows = runMysql("SELECT collection_name, JSON_UNQUOTE(JSON_EXTRACT(payload, '$')) FROM records ORDER BY collection_name, record_id;");
  recordRows.trim().split(/\r?\n/).filter(Boolean).forEach(line => {
    const tab = line.indexOf("\t");
    if (tab === -1) return;
    const collection = line.slice(0, tab);
    const payload = line.slice(tab + 1);
    if (!db[collection]) db[collection] = [];
    db[collection].push(JSON.parse(payload));
  });
  const auditRows = runMysql("SELECT JSON_UNQUOTE(JSON_EXTRACT(payload, '$')) FROM audit_events ORDER BY event_at, audit_id;");
  db.auditLog = auditRows.trim().split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  return db;
}

function writeMysqlDb(db) {
  const schemaSql = fs.readFileSync(path.join(ROOT, "database", "schema.mysql.sql"), "utf8")
    .replace(/CREATE DATABASE IF NOT EXISTS syncerp/, `CREATE DATABASE IF NOT EXISTS ${MYSQL_DATABASE}`)
    .replace(/USE syncerp;/, `USE ${MYSQL_DATABASE};`);
  const statements = [
    `CREATE DATABASE IF NOT EXISTS ${MYSQL_DATABASE} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    `USE ${MYSQL_DATABASE};`,
    schemaSql,
    "SET FOREIGN_KEY_CHECKS = 0;",
    "TRUNCATE TABLE audit_events;",
    "TRUNCATE TABLE records;",
    "TRUNCATE TABLE app_state;",
    "SET FOREIGN_KEY_CHECKS = 1;"
  ];
  ["company", "meta"].forEach(key => {
    if (!db[key] || typeof db[key] !== "object" || Array.isArray(db[key])) return;
    statements.push(
      "INSERT INTO app_state (state_key, payload) VALUES " +
      `(${sqlString(key)}, ${sqlJson(db[key])}) ` +
      "ON DUPLICATE KEY UPDATE payload = VALUES(payload);"
    );
  });
  Object.entries(db).forEach(([collection, value]) => {
    if (!Array.isArray(value) || collection === "auditLog") return;
    value.forEach((record, index) => {
      if (!record || typeof record !== "object" || Array.isArray(record)) return;
      statements.push(
        "INSERT INTO records (collection_name, record_id, project_id, status_value, owner_value, source_value, created_at_value, modified_at_value, payload) VALUES " +
        `(${sqlString(collection)}, ${sqlString(recordId(collection, record, index))}, ${sqlString(projectValue(record))}, ${sqlString(statusValue(record))}, ${sqlString(ownerValue(record))}, ${sqlString(record.source || "")}, ${sqlDate(record.createdAt || record.date || record.at)}, ${sqlDate(record.modifiedAt || record.updatedAt || record.at)}, ${sqlJson(record)}) ` +
        "ON DUPLICATE KEY UPDATE project_id = VALUES(project_id), status_value = VALUES(status_value), owner_value = VALUES(owner_value), source_value = VALUES(source_value), created_at_value = VALUES(created_at_value), modified_at_value = VALUES(modified_at_value), payload = VALUES(payload);"
      );
    });
  });
  (db.auditLog || []).forEach((event, index) => {
    if (!event || typeof event !== "object" || Array.isArray(event)) return;
    statements.push(
      "INSERT INTO audit_events (audit_id, action_value, actor_value, project_id, event_at, payload) VALUES " +
      `(${sqlString(recordId("auditLog", event, index))}, ${sqlString(event.action || event.type || "")}, ${sqlString(event.by || event.actor || "")}, ${sqlString(event.project || event.detail?.project || "")}, ${sqlDate(event.at || event.createdAt)}, ${sqlJson(event)}) ` +
      "ON DUPLICATE KEY UPDATE action_value = VALUES(action_value), actor_value = VALUES(actor_value), project_id = VALUES(project_id), event_at = VALUES(event_at), payload = VALUES(payload);"
    );
  });
  const tempPath = path.join(os.tmpdir(), `syncerp-${process.pid}-${Date.now()}.sql`);
  fs.writeFileSync(tempPath, `${statements.join("\n")}\n`);
  try {
    runMysql(fs.readFileSync(tempPath, "utf8"), "");
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function backupPayload(db, by = "Admin") {
  return {
    exportedAt: new Date().toISOString(),
    exportedBy: by,
    source: "Node server data/db.json",
    runtime: "Node app; MAMP can provide MySQL persistence later",
    data: db
  };
}

function protectedDeleteReason(collection, record = {}) {
  if (collection === "productionDailies" && ["Submitted", "Approved", "Accepted"].includes(record.status || record.reviewStatus)) return "Submitted production dailies require a correction workflow.";
  if (collection === "productionLines" && ["Submitted", "Approved", "Accepted"].includes(record.status || record.reviewStatus)) return "Submitted or approved production lines require a correction workflow.";
  if (collection === "billingLedger" && ["Ready to Bill", "Billed", "Closed / Billed"].includes(record.billingStatus)) return "Billable ledger rows require an adjustment workflow.";
  if (collection === "invoiceSubmissions") return "SQUAN submission records are audit records and cannot be deleted.";
  if (collection === "cashReceipts") return "Payment and holdback records are audit records and cannot be deleted.";
  if (collection === "contractorSettlements" && !["Draft", "Void"].includes(record.status || "Draft")) return "Issued or approved contractor settlements require a reversal/correction workflow.";
  if (collection === "contractorSettlementPayments") return "Contractor payment records are audit records and cannot be deleted.";
  if (collection === "priceSheetItems" && record.code) return "Rate sheet rows should be superseded, not deleted.";
  return "";
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": "default-src 'self'; img-src 'self' https: data:; style-src 'self' 'unsafe-inline'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'",
    ...(PRODUCTION_MODE ? { "Strict-Transport-Security": "max-age=31536000; includeSubDomains" } : {})
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function logEvent(level, event, detail = {}) {
  const order = { debug: 10, info: 20, warn: 30, error: 40 };
  if ((order[level] || 99) < (order[LOG_LEVEL] || 20)) return;
  const payload = {
    at: new Date().toISOString(),
    level,
    event,
    ...detail
  };
  const line = JSON.stringify(payload);
  if (level === "error") console.error(line);
  else console.log(line);
}

function requestId(req) {
  const incoming = req.headers["x-request-id"];
  return incoming && /^[a-zA-Z0-9._:-]{8,120}$/.test(String(incoming))
    ? String(incoming)
    : crypto.randomUUID();
}

function clientIp(req) {
  if (TRUST_PROXY && req.headers["x-forwarded-for"]) return String(req.headers["x-forwarded-for"]).split(",")[0].trim();
  return req.socket.remoteAddress || "";
}

function userAgent(req) {
  return String(req.headers["user-agent"] || "").slice(0, 300);
}

function auditContext(req) {
  return {
    requestId: req.requestId || "",
    ip: clientIp(req),
    userAgent: userAgent(req)
  };
}

function rateLimitKey(req, body = {}) {
  return `${clientIp(req)}:${String(body.email || "").toLowerCase()}`;
}

function checkLoginRateLimit(req, body = {}) {
  const key = rateLimitKey(req, body);
  const now = Date.now();
  const attempts = (loginAttempts.get(key) || []).filter(at => now - at < LOGIN_RATE_LIMIT_WINDOW_MS);
  if (attempts.length >= LOGIN_RATE_LIMIT_MAX) {
    loginAttempts.set(key, attempts);
    return false;
  }
  attempts.push(now);
  loginAttempts.set(key, attempts);
  return true;
}

function clearLoginRateLimit(req, body = {}) {
  loginAttempts.delete(rateLimitKey(req, body));
}

function productionConfigFailures() {
  const failures = [];
  if (!PRODUCTION_MODE) return failures;
  if (DEMO_AUTH_ENABLED) failures.push("DEMO_AUTH must be false in production.");
  if (!AUTH_SECRET || AUTH_SECRET === DEFAULT_AUTH_SECRET || AUTH_SECRET.length < 32) failures.push("AUTH_SECRET must be a strong production secret.");
  if (DATA_DRIVER === "json" && !ALLOW_JSON_PRODUCTION) failures.push("DATA_DRIVER=json is blocked in production unless ALLOW_JSON_PRODUCTION=true.");
  if (!ALLOW_INSECURE_HTTP) failures.push("Production deployments must terminate HTTPS before this Node server or set ALLOW_INSECURE_HTTP=true for a controlled private pilot.");
  return failures;
}

function enforceProductionConfig() {
  const failures = productionConfigFailures();
  if (failures.length) {
    throw new Error(`Production configuration blocked:\n- ${failures.join("\n- ")}`);
  }
}

function passwordHash(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const key = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${key.toString("base64url")}`;
}

function verifyPasswordHash(password, stored = "") {
  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, salt, expected] = parts;
  const actual = crypto.scryptSync(String(password), salt, 64, { N: Number(n), r: Number(r), p: Number(p) }).toString("base64url");
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

function tokenDigest(token) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(String(token)).digest("base64url");
}

function issuePasswordResetToken(db, user, req) {
  db.passwordResetTokens = db.passwordResetTokens || [];
  const token = crypto.randomBytes(32).toString("base64url");
  const now = new Date();
  const record = {
    id: `RESET-${crypto.randomUUID()}`,
    userId: user.id,
    email: user.email,
    tokenHash: tokenDigest(token),
    status: "Open",
    requestedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 30 * 60 * 1000).toISOString(),
    usedAt: "",
    notes: "Password reset token created server-side. Delivery provider integration is external.",
    activityLog: [],
    createdAt: now.toISOString(),
    modifiedAt: now.toISOString(),
    requestContext: auditContext(req)
  };
  db.passwordResetTokens.push(record);
  appendAudit(db, "auth.password-reset-requested", { user: user.email, resetId: record.id, ...auditContext(req) });
  return { token, record };
}

function consumePasswordResetToken(db, token, newPassword, req) {
  db.passwordResetTokens = db.passwordResetTokens || [];
  const digest = tokenDigest(token);
  const now = new Date().toISOString();
  const record = db.passwordResetTokens.find(item => item.tokenHash === digest && item.status === "Open");
  if (!record) return { ok: false, status: 400, error: "Invalid or expired reset token" };
  if (new Date(record.expiresAt).getTime() < Date.now()) {
    record.status = "Expired";
    record.modifiedAt = now;
    return { ok: false, status: 400, error: "Invalid or expired reset token" };
  }
  if (!newPassword || String(newPassword).length < 12) return { ok: false, status: 400, error: "Password must be at least 12 characters" };
  const user = (db.users || []).find(item => item.id === record.userId && item.email === record.email);
  if (!user) return { ok: false, status: 404, error: "User not found" };
  user.passwordHash = passwordHash(newPassword);
  user.modifiedAt = now;
  record.status = "Used";
  record.usedAt = now;
  record.modifiedAt = now;
  appendAudit(db, "auth.password-reset-completed", { user: user.email, resetId: record.id, ...auditContext(req) });
  return { ok: true, user };
}

function base64Url(input) {
  return Buffer.from(input).toString("base64url");
}

function signPayload(payload) {
  return crypto.createHmac("sha256", AUTH_SECRET).update(payload).digest("base64url");
}

function issueAuthToken(user) {
  const payload = base64Url(JSON.stringify({
    id: user.id,
    email: user.email,
    role: user.role,
    name: user.name,
    exp: Date.now() + 12 * 60 * 60 * 1000
  }));
  return `${payload}.${signPayload(payload)}`;
}

function verifyAuthToken(token, db) {
  if (!token || !token.includes(".")) return null;
  const [payload, signature] = token.split(".");
  const expected = signPayload(payload);
  if (signature.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  let claims;
  try {
    claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
  if (!claims.exp || claims.exp < Date.now()) return null;
  const user = (db.users || []).find(item => item.id === claims.id && item.email === claims.email);
  if (!user || (user.status || "Active") === "Inactive") return null;
  return user;
}

function authenticateRequest(req, db) {
  const header = req.headers.authorization || "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match ? verifyAuthToken(match[1], db) : null;
}

function requestActor(req, fallback = "System") {
  return req.user?.name || req.user?.email || fallback;
}

function canAccessCollection(user, collection, method) {
  if (collection === "auditLog" && method !== "GET") return false;
  if (user.role === "Admin") return true;
  if (method === "GET") return true;
  const role = user.role || "";
  const writeCollections = {
    Foreman: new Set(["documents", "dailies", "dailyProduction", "dailyLabor", "dailyEquipment", "dailyMaterials", "timeEntries", "fieldUploadQueue", "photoEvidence", "fieldEvidence", "tasks"]),
    Operations: new Set(["documents", "fieldUploadQueue", "tasks", "projects", "offlineSyncQueue", "obstacles", "siteSurveys"]),
    Billing: new Set(["documents", "customerContactLog", "invoices", "invoiceSubmissions", "billingLedger", "billingReadiness", "cashReceipts", "cashDepositBatches", "collectionSubmissions", "packageSnapshots", "tasks", "contractorSettlements", "contractorSettlementDeductions", "contractorSettlementPayments", "contractorAgreements"]),
    "Safety/Compliance": new Set(["documents", "safety", "fieldUploadQueue", "fieldEvidence", "photoEvidence", "formSubmissions", "tasks"]),
    "Crew Member": new Set(["fieldUploadQueue", "safety", "timeEntries", "documents", "photoEvidence"])
  };
  return writeCollections[role]?.has(collection) || false;
}

function canAccessRoute(user, req, url) {
  if (user.role === "Admin") return true;
  if (url.pathname.startsWith("/api/admin/")) return false;
  if (req.method === "GET") return true;
  if (url.pathname.startsWith("/api/company/")) return ["Billing", "Operations"].includes(user.role);
  if (url.pathname.startsWith("/api/workflows/submit-daily")) return ["Foreman", "Operations"].includes(user.role);
  if (url.pathname.startsWith("/api/workflows/billing-package")) return ["Billing", "Operations"].includes(user.role);
  if (url.pathname.startsWith("/api/workflows/daily-package-intake")) return ["Billing", "Operations"].includes(user.role);
  if (url.pathname.startsWith("/api/records/")) return true;
  return true;
}

function beforeSnapshot(collection, record) {
  if (!record || !["users", "roles", "company", "invoices", "invoiceSubmissions", "cashReceipts", "contractorSettlements", "contractorSettlementPayments", "packetLocks"].includes(collection)) return undefined;
  return JSON.parse(JSON.stringify(record));
}

function liveModeBlocker(db) {
  if (!DEMO_AUTH_ENABLED) return "";
  if ((db.company?.goLiveMode || "") !== "Live Mode") return "";
  return "Live Mode is blocked while DEMO_AUTH=true.";
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 20_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
}

function summarize(db) {
  const projects = db.projects || [];
  const invoices = db.invoices || [];
  const safety = db.safety || [];
  const dailies = db.dailies || [];
  const revenue = sum(projects, "estimatedRevenue");
  const forecastCost = sum(projects, "forecastCost");
  const retainage = sum(invoices, "retainage10");
  const openRisks = safety.filter(item => item.status !== "Closed").length;
  const blockedDailies = dailies.filter(daily => daily.jsa === "Blocked").length;
  return {
    forecastMarginPercent: revenue ? Math.round(((revenue - forecastCost) / revenue) * 100) : 0,
    forecastGrossProfit: revenue - forecastCost,
    retainageOutstanding: retainage,
    openRisks,
    squanScoreEstimate: Math.max(0, 100 - openRisks * 4 - blockedDailies * 3),
    activeProjects: projects.length,
    billingWindows: projects.filter(project => daysUntil(project.billBy) <= 14).length,
    pendingFieldUploads: (db.fieldUploadQueue || []).filter(item => !["Linked", "Accepted", "Archived"].includes(item.status)).length,
    pendingFieldCaptures: (db.offlineSyncQueue || []).filter(item => !["Synced", "Accepted", "Closed"].includes(item.status)).length
  };
}

function reportProjectPacket(db, projectId, type) {
  const project = (db.projects || []).find(item => item.id === projectId) || (db.projects || [])[0];
  if (!project) return { error: "No project found" };
  const dailyPackageExceptions = dailyPackageExceptionRows(db, project.id);
  return {
    company: db.company,
    type,
    generatedAt: new Date().toISOString(),
    project,
    readiness: (db.billingReadiness || []).find(item => item.project === project.id),
    invoices: (db.invoices || []).filter(item => item.project === project.id),
    invoiceSubmissions: (db.invoiceSubmissions || []).filter(item => item.project === project.id),
    collectionSubmissions: (db.collectionSubmissions || []).filter(item => item.project === project.id),
    retainageLedger: (db.retainageLedger || []).filter(item => item.project === project.id),
    dailies: (db.dailies || []).filter(item => item.project === project.id),
    documents: (db.documents || []).filter(item => item.project === project.id),
    photoEvidence: (db.photoEvidence || []).filter(item => item.project === project.id),
    formSubmissions: (db.formSubmissions || []).filter(item => item.project === project.id),
    fieldUploadQueue: (db.fieldUploadQueue || []).filter(item => item.project === project.id),
    siteSurveys: (db.siteSurveys || []).filter(item => item.project === project.id),
    obstacles: (db.obstacles || []).filter(item => item.project === project.id),
    qcCloseouts: (db.qcCloseouts || []).filter(item => item.project === project.id),
    safety: (db.safety || []).filter(item => item.project === project.id),
    packetLocks: (db.packetLocks || []).filter(item => item.project === project.id),
    packageSnapshots: (db.packageSnapshots || []).filter(item => item.project === project.id),
    customerContactLog: (db.customerContactLog || []).filter(item => item.project === project.id),
    dailyPackageExceptions,
    evidenceReviews: project.adminApprovals?.evidenceReviews || [],
    tasks: (db.tasks || []).filter(item => item.project === project.id),
    projectUnits: (db.projectUnits || []).filter(item => item.project === project.id),
    dailyProduction: (db.dailyProduction || []).filter(item => item.project === project.id),
    dailyLabor: (db.dailyLabor || []).filter(item => item.project === project.id),
    dailyEquipment: (db.dailyEquipment || []).filter(item => item.project === project.id),
    dailyMaterials: (db.dailyMaterials || []).filter(item => item.project === project.id)
  };
}

function dailyPackageExceptionRows(db, projectId) {
  return (db.tasks || [])
    .filter(task => task.project === projectId && task.source === "Daily package intake" && task.packageException?.status === "Approved")
    .map(task => ({
      task: task.id,
      dailyId: task.dailyId || "",
      packageId: task.packageId || "",
      checkKey: task.checkKey || "",
      label: task.gateLabel || task.title || "Daily package exception",
      status: task.packageException.status,
      by: task.packageException.by || "Billing",
      at: task.packageException.at || task.modifiedAt || "",
      reason: task.packageException.reason || "Authorized package intake exception.",
      workflowArea: task.workflowArea || "Billing"
    }))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
}

function dailyEvidencePackageId(dailyOrId) {
  const id = typeof dailyOrId === "string" ? dailyOrId : dailyOrId?.id || "";
  return `PKG-${id}`.replace(/[^A-Z0-9-]/gi, "-").toUpperCase();
}

function dailyPackageReport(db, projectId = "") {
  const projects = (db.projects || []).filter(project => !projectId || project.id === projectId);
  const rows = projects.flatMap(project => (db.dailies || [])
    .filter(daily => daily.project === project.id && daily.status === "Submitted")
    .map(daily => dailyPackageReportRow(db, project, daily)));
  const accepted = rows.filter(row => row.intakeStatus === "Accepted");
  const returned = rows.filter(row => row.intakeStatus === "Returned");
  const exceptionRows = rows.reduce((total, row) => total + row.exceptionCount, 0);
  return {
    company: db.company || {},
    generatedAt: new Date().toISOString(),
    project: projectId ? projects[0] || null : null,
    summary: {
      packageCount: rows.length,
      accepted: accepted.length,
      returned: returned.length,
      notAccepted: rows.filter(row => row.intakeStatus === "Not Accepted").length,
      qaReady: rows.filter(row => row.qaReady).length,
      exceptions: exceptionRows,
      openCorrectionTasks: rows.reduce((total, row) => total + row.openCorrectionTasks, 0)
    },
    rows,
    exceptions: projectId
      ? dailyPackageExceptionRows(db, projectId)
      : projects.flatMap(project => dailyPackageExceptionRows(db, project.id)),
    generatedFor: "Daily package intake audit, Billing handoff, SQUAN support, and year-end evidence review"
  };
}

function completedFormsReport(db, projectId = "") {
  const projects = (db.projects || []).filter(project => !projectId || project.id === projectId);
  const rows = projects.flatMap(project => completedFormsReportRows(db, project));
  return {
    company: db.company || {},
    generatedAt: new Date().toISOString(),
    project: projectId ? projects[0] || null : null,
    summary: {
      forms: rows.length,
      submitted: rows.filter(row => row.status === "Submitted").length,
      billingForms: rows.filter(row => row.requiredForBilling === "Yes").length,
      safetyForms: rows.filter(row => row.requiredForSafety === "Yes").length,
      signed: rows.filter(row => row.signatureStatus !== "Missing").length,
      needsReview: rows.filter(row => ["Pending Review", "Needs Review", "Returned"].includes(row.status)).length
    },
    rows,
    generatedFor: "Completed field form export, SQUAN support, billing packet backup, payroll support, safety audit, and year-end record review"
  };
}

function completedFormsReportRows(db, project) {
  const forms = (db.formSubmissions || []).filter(item => item.project === project.id);
  return forms.map(form => {
    const daily = (db.dailies || []).find(item => item.id === form.dailyId);
    const docs = (db.documents || []).filter(item => item.project === project.id && (item.formId === form.id || item.id === `DOC-${form.id}` || item.dailyId && item.dailyId === form.dailyId && item.type === form.type));
    const answers = typeof form.answers === "string" ? form.answers : JSON.stringify(form.answers || {});
    return {
      project: project.id,
      map: project.map || project.id,
      dailyId: form.dailyId || "",
      dailyDate: daily?.date || "",
      foreman: daily?.foreman || form.submittedBy || "",
      formId: form.id,
      formType: form.type || "",
      status: form.status || "Submitted",
      submittedBy: form.submittedBy || "",
      submittedAt: form.submittedAt || form.createdAt || "",
      requiredForBilling: docs.some(doc => doc.requiredForBilling === "Yes") || /SOT|Daily|Material|As-built|Crew Time/i.test(form.type || "") ? "Yes" : "No",
      requiredForSafety: docs.some(doc => doc.requiredForSafety === "Yes") || /JSA|PPE|Inspection|Trenching|Near Miss|Incident|Form 12|Obstacle|Street Sheet/i.test(form.type || "") ? "Yes" : "No",
      signatureStatus: form.signatures || form.signature || form.foremanSignature ? "Signed / captured" : "Missing",
      documentIds: docs.map(doc => doc.id).join("; "),
      documentPaths: docs.map(doc => doc.path || doc.name || doc.id).join("; "),
      answers,
      notes: form.notes || ""
    };
  });
}

function completedFormsCsvRows(report) {
  return (report.rows || []).map(row => ({
    project: row.project,
    map: row.map,
    dailyId: row.dailyId,
    dailyDate: row.dailyDate,
    foreman: row.foreman,
    formId: row.formId,
    formType: row.formType,
    status: row.status,
    submittedBy: row.submittedBy,
    submittedAt: row.submittedAt,
    requiredForBilling: row.requiredForBilling,
    requiredForSafety: row.requiredForSafety,
    signatureStatus: row.signatureStatus,
    documentIds: row.documentIds,
    documentPaths: row.documentPaths,
    answers: row.answers,
    notes: row.notes
  }));
}

function dailyPackageSlaStatus(db, { type, anchorDate, dueDate, owner, role }) {
  const policy = dailyPackageSlaDefaults(db.company || {});
  const age = ageDays(anchorDate) ?? 0;
  const overdue = dueDate ? daysUntil(dueDate) < 0 : false;
  const escalated = age >= policy.escalationDays || overdue;
  const aging = !escalated && age >= policy.agingDays;
  return {
    type,
    age,
    dueDate: dueDate || addDays(String(anchorDate || todayIso()).slice(0, 10), policy.escalationDays),
    owner: escalated ? "Ronald Jackson" : owner,
    role: escalated ? "Admin" : role,
    severity: escalated ? "Critical" : aging ? "High" : "Info",
    status: escalated ? "Escalated" : aging ? "Aging" : "Tracked",
    needsEscalation: escalated,
    needsAttention: escalated || aging
  };
}

function dailyPackageOwnerForPolicy(policyOwner, project, daily) {
  if (policyOwner === "Admin") return { owner: "Ronald Jackson", role: "Admin" };
  if (policyOwner === "Billing") return { owner: "Office Billing", role: "Billing" };
  if (policyOwner === "Operations") return { owner: "Operations Coordinator", role: "Operations" };
  return { owner: daily.foreman || project.crew || "Foreman", role: "Foreman" };
}

function dailyPackageSlaHandoffRows(task = {}) {
  return (task.activityLog || [])
    .filter(item => String(item.note || "").includes("Daily package SLA handoff"))
    .map(item => ({
      at: item.at || "",
      by: item.by || "System",
      note: item.note || ""
    }));
}

function dailyPackageSlaHandoffSummary(task = {}) {
  const rows = dailyPackageSlaHandoffRows(task);
  return {
    handoffCount: rows.length,
    latestHandoffAt: rows.at(-1)?.at || "",
    latestHandoffBy: rows.at(-1)?.by || "",
    latestHandoffNote: rows.at(-1)?.note || "",
    handoffHistory: rows.map(row => `${row.at}:${row.by}:${row.note}`).join(" | ")
  };
}

function dailyPackageSlaRows(db, projectId = "") {
  const policy = dailyPackageSlaDefaults(db.company || {});
  const projects = (db.projects || []).filter(project => !projectId || project.id === projectId);
  const rows = [];
  projects.forEach(project => {
    const packageRows = (db.dailies || [])
      .filter(daily => daily.project === project.id && daily.status === "Submitted")
      .map(daily => dailyPackageReportRow(db, project, daily));
    packageRows.forEach(row => {
      const daily = (db.dailies || []).find(item => item.id === row.dailyId) || {};
      const returnedOwner = dailyPackageOwnerForPolicy(policy.returnedOwner, project, daily);
      const readyOwner = dailyPackageOwnerForPolicy(policy.readyOwner, project, daily);
      if (row.intakeStatus === "Returned") {
        const anchorDate = row.intakeAt || row.snapshotModifiedAt || row.dailyDate;
        const sla = dailyPackageSlaStatus(db, {
          type: "Returned package",
          anchorDate,
          dueDate: addDays(String(anchorDate || row.dailyDate || "").slice(0, 10), policy.escalationDays),
          owner: returnedOwner.owner,
          role: returnedOwner.role
        });
        rows.push({
          rowType: "Package",
          project: project.id,
          map: project.map || project.id,
          packageId: row.packageId,
          dailyId: row.dailyId,
          dailyDate: row.dailyDate,
          foreman: row.foreman,
          label: "Returned daily package",
          detail: row.intakeNote || "Billing returned this package for correction before invoice build.",
          intakeStatus: row.intakeStatus,
          qaStatus: row.qaStatus,
          taskId: "",
          taskStatus: "",
          taskOwner: "",
          handoffCount: 0,
          latestHandoffAt: "",
          latestHandoffBy: "",
          latestHandoffNote: "",
          handoffHistory: "",
          ...sla
        });
      }
      if (row.qaReady && row.intakeStatus !== "Accepted" && row.intakeStatus !== "Returned") {
        const anchorDate = row.snapshotModifiedAt || row.dailyDate;
        const sla = dailyPackageSlaStatus(db, {
          type: "Ready / unaccepted",
          anchorDate,
          dueDate: addDays(String(row.dailyDate || anchorDate || "").slice(0, 10), policy.escalationDays),
          owner: readyOwner.owner,
          role: readyOwner.role
        });
        rows.push({
          rowType: "Package",
          project: project.id,
          map: project.map || project.id,
          packageId: row.packageId,
          dailyId: row.dailyId,
          dailyDate: row.dailyDate,
          foreman: row.foreman,
          label: "Ready package waiting on Billing",
          detail: "QA is ready; Billing needs to accept the package for invoice build.",
          intakeStatus: row.intakeStatus,
          qaStatus: row.qaStatus,
          taskId: "",
          taskStatus: "",
          taskOwner: "",
          handoffCount: 0,
          latestHandoffAt: "",
          latestHandoffBy: "",
          latestHandoffNote: "",
          handoffHistory: "",
          ...sla
        });
      }
    });
    (db.tasks || [])
      .filter(task => task.project === project.id && task.source === "Daily package intake" && task.status !== "Closed")
      .forEach(task => {
        const packageId = task.packageId || dailyEvidencePackageId(task.dailyId || "");
        const handoff = dailyPackageSlaHandoffSummary(task);
        const sla = dailyPackageSlaStatus(db, {
          type: "Correction task",
          anchorDate: task.createdAt || task.modifiedAt || task.dueDate,
          dueDate: task.dueDate,
          owner: task.owner || "Office Billing",
          role: task.role || "Billing"
        });
        rows.push({
          rowType: "Correction Task",
          project: project.id,
          map: project.map || project.id,
          packageId,
          dailyId: task.dailyId || "",
          dailyDate: "",
          foreman: "",
          label: task.title || "Daily package correction task",
          detail: task.notes || "Correction task is open before Billing can accept this package.",
          intakeStatus: "",
          qaStatus: task.gateStatus || "",
          taskId: task.id,
          taskStatus: task.status,
          taskOwner: task.owner || "",
          ...handoff,
          ...sla
        });
      });
    (db.tasks || [])
      .filter(task => task.project === project.id && task.source === "Daily package SLA")
      .forEach(task => {
        const handoff = dailyPackageSlaHandoffSummary(task);
        rows.push({
          rowType: "SLA Task",
          project: project.id,
          map: project.map || project.id,
          packageId: task.packageId || "",
          dailyId: task.dailyId || "",
          dailyDate: "",
          foreman: "",
          label: task.title || "Daily package SLA task",
          detail: task.notes || "",
          intakeStatus: "",
          qaStatus: "",
          taskId: task.id,
          taskStatus: task.status,
          taskOwner: task.owner || "",
          ...handoff,
          type: "SLA follow-up task",
          age: task.slaAge ?? ageDays(task.createdAt || task.modifiedAt || task.dueDate) ?? 0,
          dueDate: task.dueDate || "",
          owner: task.owner || "",
          role: task.role || "",
          severity: task.status === "Closed" ? "Info" : "Critical",
          status: task.status === "Closed" ? "Closed" : task.slaStatus || "Escalated",
          needsEscalation: task.status !== "Closed",
          needsAttention: task.status !== "Closed"
        });
      });
  });
  const rank = { Critical: 0, High: 1, Medium: 2, Info: 3 };
  return rows.sort((a, b) => (rank[a.severity] ?? 9) - (rank[b.severity] ?? 9) || Number(b.age || 0) - Number(a.age || 0));
}

function dailyPackageSlaReport(db, projectId = "") {
  const rows = dailyPackageSlaRows(db, projectId);
  const projects = (db.projects || []).filter(project => !projectId || project.id === projectId);
  const policy = dailyPackageSlaDefaults(db.company || {});
  return {
    company: db.company || {},
    generatedAt: new Date().toISOString(),
    project: projectId ? projects[0] || null : null,
    policy,
    summary: {
      rows: rows.length,
      aging: rows.filter(row => row.status === "Aging").length,
      escalated: rows.filter(row => row.status === "Escalated").length,
      handoffs: rows.reduce((total, row) => total + Number(row.handoffCount || 0), 0),
      activeSlaTasks: rows.filter(row => row.rowType === "SLA Task" && row.taskStatus !== "Closed").length,
      returnedPackages: rows.filter(row => row.type === "Returned package").length,
      readyUnaccepted: rows.filter(row => row.type === "Ready / unaccepted").length,
      correctionTasks: rows.filter(row => row.type === "Correction task").length
    },
    rows,
    generatedFor: "Daily package SLA breach review, Billing intake follow-up, management escalation, and audit support"
  };
}

function dailyPackageReportRow(db, project, daily) {
  const packageId = dailyEvidencePackageId(daily.id);
  const docs = (db.documents || []).filter(item => item.project === project.id && (item.dailyId === daily.id || item.packageId === packageId));
  const forms = (db.formSubmissions || []).filter(item => item.project === project.id && (item.dailyId === daily.id || item.packageId === packageId));
  const photos = (db.photoEvidence || []).filter(item => item.project === project.id && (item.linkedRecord === daily.id || item.packageId === packageId));
  const time = (db.timeEntries || []).filter(item => item.project === project.id && (item.dailyId === daily.id || item.packageId === packageId || String(item.notes || "").includes(daily.id)));
  const qc = (db.qcCloseouts || []).filter(item => item.project === project.id && (item.dailyId === daily.id || item.packageId === packageId || String(item.notes || "").includes(daily.id)));
  const readiness = (db.billingReadiness || []).find(item => item.project === project.id);
  const tasks = (db.tasks || []).filter(task => task.project === project.id && task.source === "Daily package intake" && task.dailyId === daily.id);
  const snapshot = (db.packageSnapshots || []).find(item => item.id === packageId || item.scope === "Daily Evidence Package" && item.dailyId === daily.id);
  const checks = [
    { key: "daily-report", label: "Daily Report", ok: docs.some(item => item.type === "Daily Report" && item.status === "Submitted") },
    { key: "sot", label: "SOT", ok: docs.some(item => item.type === "SOT" && item.status === "Submitted") },
    { key: "forms", label: "JSA / forms", ok: forms.some(item => item.type === "JSA" && item.status === "Submitted") },
    { key: "photos", label: "Photo evidence", ok: photos.length > 0 },
    { key: "time", label: "Crew time", ok: time.length > 0 && time.every(item => ["Approved", "Ready"].some(status => String(item.approvalStatus || item.payrollStatus || "").includes(status))) },
    { key: "materials", label: "Materials", ok: docs.some(item => item.type === "Material Usage" && item.status === "Submitted") },
    { key: "qc", label: "QC review", ok: qc.length > 0 },
    { key: "billing", label: "Billing readiness", ok: Boolean(readiness) && readiness.submittedDailies > 0 }
  ].map(check => {
    const exception = tasks.find(task => task.checkKey === check.key && task.packageException?.status === "Approved")?.packageException;
    return exception ? { ...check, ok: true, exception } : check;
  });
  const missing = checks.filter(check => !check.ok);
  const exceptions = tasks.filter(task => task.packageException?.status === "Approved");
  return {
    project: project.id,
    map: project.map || project.id,
    packageId,
    dailyId: daily.id,
    dailyDate: daily.date || "",
    foreman: daily.foreman || "",
    production: daily.production || "",
    intakeStatus: snapshot?.billingIntake?.status || "Not Accepted",
    intakeBy: snapshot?.billingIntake?.by || "",
    intakeAt: snapshot?.billingIntake?.at || "",
    intakeNote: snapshot?.billingIntake?.note || "",
    snapshotModifiedAt: snapshot?.modifiedAt || "",
    qaReady: missing.length === 0,
    qaStatus: missing.length ? "Needs Review" : "Ready",
    missingChecks: missing.map(item => item.label).join("; "),
    docCount: docs.length,
    formCount: forms.length,
    photoCount: photos.length,
    timeCount: time.length,
    qcCount: qc.length,
    snapshotStatus: snapshot?.status || "Missing",
    openCorrectionTasks: tasks.filter(task => task.status !== "Closed").length,
    closedCorrectionTasks: tasks.filter(task => task.status === "Closed").length,
    exceptionCount: exceptions.length,
    exceptionReasons: exceptions.map(task => `${task.gateLabel || task.checkKey}: ${task.packageException.reason}`).join("; "),
    taskIds: tasks.map(task => task.id).join("; "),
    evidenceIds: [...docs, ...forms, ...photos, ...time, ...qc].map(item => item.id).join("; ")
  };
}

function dailyPackageCsvRows(report) {
  return (report.rows || []).map(row => ({
    project: row.project,
    map: row.map,
    packageId: row.packageId,
    dailyId: row.dailyId,
    dailyDate: row.dailyDate,
    foreman: row.foreman,
    intakeStatus: row.intakeStatus,
    intakeBy: row.intakeBy,
    intakeAt: row.intakeAt,
    qaStatus: row.qaStatus,
    missingChecks: row.missingChecks,
    docs: row.docCount,
    forms: row.formCount,
    photos: row.photoCount,
    timeRows: row.timeCount,
    qcRows: row.qcCount,
    openCorrectionTasks: row.openCorrectionTasks,
    closedCorrectionTasks: row.closedCorrectionTasks,
    exceptions: row.exceptionCount,
    exceptionReasons: row.exceptionReasons,
    taskIds: row.taskIds,
    evidenceIds: row.evidenceIds,
    intakeNote: row.intakeNote
  }));
}

function dailyPackageSlaCsvRows(report) {
  return (report.rows || []).map(row => ({
    rowType: row.rowType,
    project: row.project,
    map: row.map,
    packageId: row.packageId,
    dailyId: row.dailyId,
    dailyDate: row.dailyDate,
    foreman: row.foreman,
    label: row.label,
    type: row.type,
    status: row.status,
    severity: row.severity,
    ageDays: row.age,
    dueDate: row.dueDate,
    owner: row.owner,
    role: row.role,
    needsAttention: row.needsAttention ? "Yes" : "No",
    needsEscalation: row.needsEscalation ? "Yes" : "No",
    intakeStatus: row.intakeStatus,
    qaStatus: row.qaStatus,
    taskId: row.taskId,
    taskStatus: row.taskStatus,
    taskOwner: row.taskOwner,
    handoffCount: row.handoffCount || 0,
    latestHandoffAt: row.latestHandoffAt || "",
    latestHandoffBy: row.latestHandoffBy || "",
    latestHandoffNote: row.latestHandoffNote || "",
    handoffHistory: row.handoffHistory || "",
    detail: row.detail
  }));
}

function reportExceptionPacket(db, projectId) {
  const packet = reportProjectPacket(db, projectId, "exception");
  if (packet.error) return packet;
  const exception = packet.project.adminApprovals?.exception || null;
  const evidenceLinks = exception?.evidenceLinks || [];
  const linkedEvidence = evidenceLinks
    .map(link => {
      const rows = db[link.collection] || [];
      const record = rows.find(item => item.id === link.id);
      return record ? { collection: link.collection, id: link.id, record } : null;
    })
    .filter(Boolean);
  return {
    ...packet,
    exception,
    linkedEvidence,
    changeHistory: exception?.changeHistory || [],
    generatedFor: "SQUAN/customer exception support, safety audit, and year-end documentation"
  };
}

function reportFieldCaptureAudit(db, projectId = "") {
  const project = (db.projects || []).find(item => item.id === projectId) || (db.projects || [])[0];
  if (!project) return { error: "No project found" };
  const rows = fieldCaptureAuditRows(db, project.id);
  const accepted = rows.filter(item => item.reviewStatus === "Accepted");
  const pending = rows.filter(item => !["Accepted", "Closed"].includes(item.reviewStatus));
  const corrected = rows.filter(item => item.correctionCount > 0);
  const linked = rows.filter(item => item.acceptedForBilling || item.acceptedForSafety || item.acceptedForCloseout);
  return {
    company: db.company,
    generatedAt: new Date().toISOString(),
    project,
    summary: {
      totalCaptures: rows.length,
      accepted: accepted.length,
      pendingReview: pending.length,
      corrected: corrected.length,
      linkedEvidence: linked.length,
      billingLinked: rows.filter(item => item.acceptedForBilling).length,
      safetyLinked: rows.filter(item => item.acceptedForSafety).length,
      closeoutLinked: rows.filter(item => item.acceptedForCloseout).length
    },
    rows,
    sourceRecords: {
      offlineSyncQueue: (db.offlineSyncQueue || []).filter(item => item.project === project.id),
      photoEvidence: (db.photoEvidence || []).filter(item => item.project === project.id),
      obstacles: (db.obstacles || []).filter(item => item.project === project.id)
    },
    generatedFor: "Field capture lifecycle audit, SQUAN support packet, billing evidence, safety review, and closeout documentation"
  };
}

function fieldCaptureAuditRows(db, projectId) {
  return (db.offlineSyncQueue || [])
    .filter(item => item.project === projectId)
    .filter(item => item.type !== "Sync confirmation")
    .map(item => {
      const isPhoto = item.type === "GPS photo capture";
      const isMarkup = item.type === "Map markup pin";
      const collection = isPhoto ? "photoEvidence" : isMarkup ? "obstacles" : "offlineSyncQueue";
      const related = collection === "offlineSyncQueue" ? item : (db[collection] || []).find(record => record.id === item.relatedRecord) || {};
      const review = item.review || {};
      const reviewStatus = review.status || related.reviewStatus || (item.status === "Synced" ? "Pending Review" : item.status || "Queued");
      const acceptedForBilling = item.acceptedForBilling === "Yes" || related.acceptedForBilling === "Yes";
      const acceptedForSafety = item.acceptedForSafety === "Yes" || related.acceptedForSafety === "Yes";
      const acceptedForCloseout = item.acceptedForCloseout === "Yes" || related.acceptedForCloseout === "Yes";
      const corrections = item.correctionVersions || [];
      return {
        id: item.id,
        project: item.project,
        map: projectLabel(db, item.project),
        type: item.type || "",
        collection,
        relatedRecord: item.relatedRecord || related.id || item.id,
        summary: item.summary || related.caption || related.description || "Field capture waiting for review.",
        blockerImpact: item.blockerImpact || related.blockerImpact || related.impact || "No blocker",
        syncStatus: item.status || "Queued",
        capturedBy: item.capturedBy || related.createdBy || "",
        capturedAt: item.createdAt || related.createdAt || "",
        syncedAt: item.syncedAt || "",
        reviewStatus,
        reviewedBy: review.reviewedBy || related.reviewedBy || "",
        reviewedAt: review.reviewedAt || related.reviewedAt || "",
        reviewNote: review.note || related.reviewNotes || "",
        correctionCount: corrections.length,
        correctionHistory: corrections.map(version => ({
          version: version.version || "",
          at: version.at || version.createdAt || "",
          by: version.by || "",
          summary: version.summary || version.note || ""
        })),
        acceptedForBilling,
        acceptedForSafety,
        acceptedForCloseout,
        evidenceKey: item.evidenceKey || related.evidenceKey || "",
        evidenceLinkage: [acceptedForBilling ? "Billing" : "", acceptedForSafety ? "Safety" : "", acceptedForCloseout ? "Closeout" : ""].filter(Boolean).join(", "),
        lifecycle: [
          { step: "Captured", status: item.createdAt || related.createdAt ? "Complete" : "Missing", at: item.createdAt || related.createdAt || "", by: item.capturedBy || related.createdBy || "" },
          { step: "Synced", status: item.syncedAt || item.status === "Synced" || reviewStatus === "Accepted" ? "Complete" : item.status || "Queued", at: item.syncedAt || "", by: item.syncedBy || "" },
          { step: "Corrected", status: corrections.length ? "Versioned" : "No correction", at: corrections[corrections.length - 1]?.at || "", by: corrections[corrections.length - 1]?.by || "" },
          { step: "Reviewed", status: reviewStatus, at: review.reviewedAt || related.reviewedAt || "", by: review.reviewedBy || related.reviewedBy || "" },
          { step: "Evidence linked", status: acceptedForBilling || acceptedForSafety || acceptedForCloseout ? "Linked" : "Not linked", at: review.reviewedAt || related.reviewedAt || "", by: review.reviewedBy || related.reviewedBy || "" }
        ]
      };
    })
    .sort((a, b) => String(b.capturedAt || "").localeCompare(String(a.capturedAt || "")));
}

function fieldCaptureAuditCsvRows(report) {
  return (report.rows || []).map(item => ({
    captureId: item.id,
    project: item.project,
    map: item.map,
    type: item.type,
    collection: item.collection,
    relatedRecord: item.relatedRecord,
    syncStatus: item.syncStatus,
    reviewStatus: item.reviewStatus,
    blockerImpact: item.blockerImpact,
    capturedBy: item.capturedBy,
    capturedAt: item.capturedAt,
    syncedAt: item.syncedAt,
    reviewedBy: item.reviewedBy,
    reviewedAt: item.reviewedAt,
    correctionCount: item.correctionCount,
    correctionHistory: (item.correctionHistory || []).map(version => `v${version.version} ${version.at} ${version.by}: ${version.summary}`).join(" | "),
    acceptedForBilling: item.acceptedForBilling ? "Yes" : "No",
    acceptedForSafety: item.acceptedForSafety ? "Yes" : "No",
    acceptedForCloseout: item.acceptedForCloseout ? "Yes" : "No",
    evidenceKey: item.evidenceKey,
    evidenceLinkage: item.evidenceLinkage,
    reviewNote: item.reviewNote,
    summary: item.summary
  }));
}

function reportPacketLocks(db, { projectId = "", scope = "" } = {}) {
  const locks = (db.packetLocks || [])
    .filter(lock => !projectId || lock.project === projectId)
    .filter(lock => !scope || lock.scope === scope);
  const projectIds = [...new Set([projectId, ...locks.map(lock => lock.project)].filter(Boolean))];
  const packetTasks = (db.tasks || []).filter(task => projectIds.includes(task.project) && String(task.source || "").toLowerCase().includes("packet"));
  const alertControls = (db.alertControls || []).filter(control => !control.project || projectIds.includes(control.project));
  const scopeMismatchEvents = (db.auditLog || []).filter(event => event.action === "packet.refinalization-scope-mismatch" && projectIds.includes(event.detail?.project));
  const resolvedScopeMismatches = alertControls.filter(control => control.kind === "Resolved" && String(control.alertId || "").startsWith("packet-scope-mismatch:"));
  const evidenceReviews = (db.projects || [])
    .filter(project => projectIds.includes(project.id))
    .flatMap(project => (project.adminApprovals?.evidenceReviews || []).map(review => ({
      ...review,
      project: project.id,
      map: project.map || project.id,
      customer: project.customer || ""
    })));
  return {
    company: db.company,
    generatedAt: new Date().toISOString(),
    filters: { project: projectId || "All", scope: scope || "All" },
    summary: {
      total: locks.length,
      finalized: locks.filter(lock => lock.status === "Finalized").length,
      reopened: locks.filter(lock => lock.status === "Reopened").length,
      scopes: [...new Set(locks.map(lock => lock.scope).filter(Boolean))],
      alertControls: alertControls.length,
      scopeMismatches: scopeMismatchEvents.length,
      resolvedScopeMismatches: resolvedScopeMismatches.length,
      openPacketTasks: packetTasks.filter(task => task.status !== "Closed").length,
      evidenceReviews: evidenceReviews.length,
      evidenceAccepted: evidenceReviews.filter(review => review.status === "Accepted").length,
      evidenceRejected: evidenceReviews.filter(review => review.status === "Rejected").length
    },
    projects: (db.projects || []).filter(project => projectIds.includes(project.id)),
    packetLocks: locks.map(lock => ({
      ...lock,
      reopenTask: packetTasks.find(task => task.id === lock.reopenTaskId || task.project === lock.project && task.status !== "Closed") || null
    })),
    packetTasks,
    evidenceReviews,
    alertControls,
    scopeMismatchEvents,
    resolvedScopeMismatches,
    timeline: locks.flatMap(lock => packetLockReportTimeline(lock)).sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
  };
}

function reportCashForecast(db, scenarioKey = "baseline") {
  const scenario = cashScenarioConfig(db, scenarioKey);
  const inflows = cashForecastRows(db, scenario.key);
  const outflows = cashOutflowRows(db);
  const summary = cashForecastSummary(db, inflows, outflows);
  const buckets = forecastWeekBuckets(db, inflows, outflows, summary.startingCash);
  const reconciliation = cashReconciliationRows(db);
  const cashTasks = (db.tasks || []).filter(task => task.source === "Cash decision workflow");
  const decisionHistory = (db.company?.cashDecisionLog || []).map(entry => {
    const task = cashTasks.find(item => item.id === entry.task) || {};
    const originalEnding = Number(entry.endingCash || task.projectedEndingCash || 0);
    const delta = summary.endingCash - originalEnding;
    return {
      ...entry,
      taskStatus: task.status || entry.status || "Logged",
      taskOwner: task.owner || "Unassigned",
      originalEnding,
      currentEnding: summary.endingCash,
      forecastDelta: delta,
      forecastStatus: delta > 0 ? "Improved" : delta < 0 ? "Worse" : "No Change",
      reviewStatus: entry.reviewedAt ? "Reviewed" : task.status === "Closed" || entry.status === "Closed" ? "Ready for Review" : "Open"
    };
  });
  return {
    company: db.company,
    generatedAt: new Date().toISOString(),
    scenario,
    summary,
    assumptions: {
      cashOnHand: Number(db.company?.cashOnHand || 50000),
      weeklyOverhead: Number(db.company?.weeklyOverhead || 8500),
      minimumCashThreshold: Number(db.company?.minimumCashThreshold || 0),
      cashScenarioDelays: db.company?.cashScenarioDelays || {}
    },
    inflows,
    outflows,
    buckets,
    reconciliation,
    openFollowThroughTasks: cashTasks.filter(task => task.status !== "Closed"),
    cashDecisionTasks: cashTasks,
    decisionHistory,
    cashControlHistory: db.company?.cashControlHistory || []
  };
}

function cashScenarioConfig(db, key = "baseline") {
  const delays = db.company?.cashScenarioDelays || {};
  const configs = {
    baseline: { key: "baseline", label: "Baseline", delayDays: Number(delays.baseline ?? 0) },
    delay15: { key: "delay15", label: "15-day delay", delayDays: Number(delays.delay15 ?? 15) },
    delay30: { key: "delay30", label: "30-day delay", delayDays: Number(delays.delay30 ?? 30) },
    delay45: { key: "delay45", label: "45-day delay", delayDays: Number(delays.delay45 ?? 45) }
  };
  return configs[key] || configs.baseline;
}

function cashForecastRows(db, scenarioKey = "baseline") {
  const scenario = cashScenarioConfig(db, scenarioKey);
  const paymentRows = paymentFollowUpRows(db)
    .filter(item => !item.paid90Complete && item.open90 > 0)
    .map(item => {
      const isHold = item.status === "Pay-when-paid hold";
      const baseDate = isHold ? addDays(item.followUpDate || todayIso(), 15) : item.followUpDate || addDays(todayIso(), 30);
      return {
        id: `AR-${item.invoice}`,
        project: item.project,
        map: projectLabel(db, item.project),
        type: "90% AR",
        expectedDate: addDays(baseDate, scenario.delayDays),
        amount: item.open90,
        confidence: isHold || item.status === "Past Due" ? "At Risk" : "Expected",
        status: item.status,
        detail: isHold ? "Pay-when-paid adds timing risk." : item.detail
      };
    });
  const retainageRows = (db.retainageLedger || [])
    .filter(item => !["Released / Paid", "Paid"].includes(item.status))
    .map(item => ({
      id: `RET-${item.id}`,
      project: item.project,
      map: projectLabel(db, item.project),
      type: "Retainage",
      expectedDate: item.releaseDate,
      amount: Number(item.heldAmount || 0),
      confidence: item.status === "Disputed" || item.disputeReason && item.disputeReason !== "None" ? "At Risk" : "Future",
      status: item.status || "Held",
      detail: item.paymentNote || item.notes || "Retainage release tracked."
    }));
  const readyBilling = (db.billingReadiness || [])
    .filter(item => item.status === "Ready to Bill" && Number(item.billableAmount || 0) > 0)
    .map(item => ({
      id: `UNBILLED-${item.project}`,
      project: item.project,
      map: projectLabel(db, item.project),
      type: "Ready invoice",
      expectedDate: addDays(item.billingDeadline || todayIso(), 30 + scenario.delayDays),
      amount: Number(item.billableAmount || 0) * 0.9,
      confidence: "Expected",
      status: "Ready to Bill",
      detail: "Projected 90% cash after SQUAN acceptance once invoice is submitted."
    }));
  return [...paymentRows, ...readyBilling, ...retainageRows].sort((a, b) => String(a.expectedDate).localeCompare(String(b.expectedDate)));
}

function paymentFollowUpRows(db) {
  return (db.invoiceSubmissions || []).map(submission => {
    const invoice = (db.invoices || []).find(item => item.id === submission.invoice || item.project === submission.project) || {};
    const followUpDate = submission.followUpDate || submission.receipt?.followUpDate || "";
    const expected90 = Number(submission.expected90 || invoice.gross * 0.9 || 0);
    const paid90 = Number(invoice.paid90 || 0);
    const paid90Complete = paid90 >= expected90 && expected90 > 0;
    const statusText = String(invoice.status || submission.status || "");
    const status = statusText.includes("Pay-when-paid")
      ? "Pay-when-paid hold"
      : ["Disputed", "Short-paid", "Chargeback received", "Rejected by SQUAN"].includes(statusText)
        ? statusText
        : paid90Complete
          ? "Paid 90% / Retainage Held"
          : daysUntil(followUpDate) < 0
            ? "Past Due"
            : "Monitor";
    return {
      id: submission.id,
      project: submission.project,
      invoice: invoice.id || submission.invoiceNumber || submission.invoice,
      status,
      followUpDate,
      expected90,
      paid90,
      open90: Math.max(0, expected90 - paid90),
      paid90Complete,
      detail: `${Math.max(0, expected90 - paid90)} open against expected 90%; follow-up ${followUpDate || "not scheduled"}.`
    };
  });
}

function cashOutflowRows(db) {
  const timeRows = (db.timeEntries || [])
    .filter(item => item.payrollStatus !== "Exported")
    .map(item => {
      const regular = Number(item.regularHours || 0) + Number(item.travelHours || 0) + Number(item.standbyHours || 0);
      const overtime = Number(item.overtimeHours || 0);
      const rate = roleLaborRate(item.role);
      return {
        id: `PAY-${item.id}`,
        project: item.project,
        map: projectLabel(db, item.project),
        type: "Payroll",
        expectedDate: nextFriday(item.date || todayIso()),
        amount: Math.round((regular * rate + overtime * rate * 1.5) * 1.18),
        status: item.payrollStatus || "Pending",
        detail: `${item.employee}: ${regular + overtime} hour(s), burdened payroll estimate.`
      };
    })
    .filter(item => item.amount > 0);
  const equipmentRows = (db.dailyEquipment || [])
    .map(item => ({
      id: `EQCOST-${item.dailyId}-${item.equipmentId}`,
      project: item.project,
      map: projectLabel(db, item.project),
      type: "Equipment cost",
      expectedDate: addDays((db.dailies || []).find(daily => daily.id === item.dailyId)?.date || todayIso(), 14),
      amount: Math.round(Number(item.hours || 0) * Number(item.rate || 0)),
      status: "Scheduled",
      detail: `${item.equipmentId}: ${Number(item.hours || 0)} hour(s).`
    }))
    .filter(item => item.amount > 0);
  const projectBurn = (db.projects || [])
    .filter(project => !["Completed / Billed", "Closed"].includes(project.status))
    .flatMap(project => {
      const remaining = Math.max(0, Number(project.forecastCost || 0) - Number(project.actualCost || 0));
      if (!remaining) return [];
      return Array.from({ length: 6 }, (_, index) => ({
        id: `BURN-${project.id}-${index + 1}`,
        project: project.id,
        map: projectLabel(db, project.id),
        type: "Forecast burn",
        expectedDate: addDays(todayIso(), 7 * (index + 1)),
        amount: Math.round(remaining / 6),
        status: "Forecast",
        detail: `${project.map || project.id}: remaining forecast cost spread across 6 weeks.`
      }));
    });
  const weeklyOverhead = Number(db.company?.weeklyOverhead || 8500);
  const overhead = Array.from({ length: 13 }, (_, index) => ({
    id: `OH-${index + 1}`,
    project: "",
    map: "Company overhead",
    type: "Overhead",
    expectedDate: addDays(todayIso(), 7 * index + 5),
    amount: weeklyOverhead,
    status: "Forecast",
    detail: "Estimated weekly overhead."
  }));
  return [...timeRows, ...equipmentRows, ...projectBurn, ...overhead].sort((a, b) => String(a.expectedDate).localeCompare(String(b.expectedDate)));
}

function cashForecastSummary(db, inflows, outflows) {
  const horizonEnd = addDays(todayIso(), 91);
  const next13 = inflows.filter(item => item.expectedDate && item.expectedDate <= horizonEnd);
  const outflow13 = outflows.filter(item => item.expectedDate && item.expectedDate <= horizonEnd);
  const reconciliation = cashReconciliationRows(db);
  const startingCash = Number(db.company?.cashOnHand || 50000);
  const endingCash = startingCash + sum(next13, "amount") - sum(outflow13, "amount");
  const minimumCashThreshold = Number(db.company?.minimumCashThreshold || 0);
  return {
    startingCash,
    endingCash,
    minimumCashThreshold,
    thresholdGap: endingCash - minimumCashThreshold,
    next13Total: sum(next13, "amount"),
    outflow13Total: sum(outflow13, "amount"),
    net13: sum(next13, "amount") - sum(outflow13, "amount"),
    actualReceived: sum(reconciliation, "actualAmount"),
    receiptVariance: sum(reconciliation, "variance"),
    openReceiptVariance: sum(reconciliation.filter(item => item.status !== "Reconciled"), "variance"),
    atRisk: sum(inflows.filter(item => item.confidence === "At Risk"), "amount"),
    futureRetainage: sum(inflows.filter(item => item.type === "Retainage" && item.expectedDate > horizonEnd), "amount"),
    payWhenPaidCount: paymentFollowUpRows(db).filter(item => item.status === "Pay-when-paid hold").length
  };
}

function cashReconciliationRows(db) {
  return (db.cashReceipts || []).map(receipt => ({
    id: receipt.id,
    project: receipt.project,
    map: projectLabel(db, receipt.project),
    invoice: receipt.invoice,
    type: receipt.type || "Cash receipt",
    expectedDate: receipt.expectedDate || "",
    actualDate: receipt.actualDate || receipt.receivedAt || "",
    expectedAmount: Number(receipt.expectedAmount || 0),
    actualAmount: Number(receipt.actualAmount || 0),
    variance: Number(receipt.actualAmount || 0) - Number(receipt.expectedAmount || 0),
    status: receipt.status || "Reconciled",
    depositStatus: receipt.depositStatus || "",
    bankProof: receipt.bankProof || "",
    depositBatch: receipt.depositBatch || "",
    reference: receipt.reference || "",
    notes: receipt.notes || ""
  })).sort((a, b) => String(b.actualDate || "").localeCompare(String(a.actualDate || "")));
}

function cashDepositBatchRows(db) {
  const receipts = db.cashReceipts || [];
  return (db.cashDepositBatches || []).map(batch => {
    const batchReceipts = receipts.filter(receipt => (batch.receiptIds || []).includes(receipt.id) || receipt.depositBatch === batch.id);
    const receiptTotal = sum(batchReceipts, "actualAmount");
    const bankFeedAmount = Number(batch.bankFeedAmount || 0);
    return {
      ...batch,
      receiptCount: batchReceipts.length,
      receiptTotal,
      bankFeedAmount,
      variance: receiptTotal - bankFeedAmount,
      proofCount: batchReceipts.filter(receipt => receipt.bankProof).length,
      verifiedReceiptCount: batchReceipts.filter(receipt => receipt.depositStatus === "Deposit Verified").length,
      status: batch.status || (receiptTotal === bankFeedAmount && batchReceipts.every(receipt => receipt.bankProof) ? "Ready to Verify" : "Needs Review"),
      receipts: batchReceipts.map(receipt => receipt.id)
    };
  }).sort((a, b) => String(b.depositDate || "").localeCompare(String(a.depositDate || "")));
}

function arAgeBucket(daysPastDue) {
  if (daysPastDue <= 0) return "Current";
  if (daysPastDue <= 30) return "1-30";
  if (daysPastDue <= 60) return "31-60";
  if (daysPastDue <= 90) return "61-90";
  return "90+";
}

function arAgingRows(db) {
  const paymentRows = paymentFollowUpRows(db)
    .filter(item => !item.paid90Complete && item.open90 > 0)
    .map(item => {
      const dueDate = item.followUpDate || addDays(todayIso(), 30);
      const days = daysUntil(dueDate);
      const daysPastDue = days === null ? 0 : Math.max(0, -days);
      return {
        id: `AR90-${item.invoice}`,
        kind: "90% AR",
        project: item.project,
        map: projectLabel(db, item.project),
        invoice: item.invoice,
        amount: item.open90,
        dueDate,
        daysPastDue,
        bucket: arAgeBucket(daysPastDue),
        status: item.status,
        risk: ["Past Due", "Pay-when-paid hold", "Disputed", "Short-paid", "Chargeback received"].includes(item.status) ? "High" : daysPastDue > 0 ? "Medium" : "Normal",
        owner: "Office Billing",
        detail: item.detail
      };
    });
  const retainageRows = (db.retainageLedger || [])
    .filter(item => !["Released / Paid", "Paid"].includes(item.status))
    .map(item => {
      const dueDate = item.releaseDate || item.followUpDate || "";
      const days = daysUntil(dueDate);
      const daysPastDue = days === null ? 0 : Math.max(0, -days);
      const project = (db.projects || []).find(row => row.id === item.project);
      return {
        id: `RET-${item.id}`,
        kind: "Retainage",
        project: item.project,
        map: project ? `${project.map || project.id} - ${project.scope}` : item.project,
        invoice: item.invoice,
        amount: Number(item.heldAmount || 0),
        dueDate,
        daysPastDue,
        bucket: arAgeBucket(daysPastDue),
        status: item.status || "Held",
        risk: item.status === "Disputed" || item.disputeReason && item.disputeReason !== "None" || daysPastDue > 0 ? "High" : "Normal",
        owner: "Office Billing",
        detail: item.paymentNote || item.notes || "Retainage release tracked."
      };
    });
  const readyRows = (db.billingReadiness || [])
    .filter(item => item.status === "Ready to Bill" && Number(item.billableAmount || 0) > 0)
    .map(item => {
      const days = daysUntil(item.billingDeadline);
      const daysPastDue = days === null ? 0 : Math.max(0, -days);
      return {
        id: `UNBILLED-${item.project}`,
        kind: "Unbilled Ready",
        project: item.project,
        map: projectLabel(db, item.project),
        invoice: "Not submitted",
        amount: Number(item.billableAmount || 0),
        dueDate: item.billingDeadline,
        daysPastDue,
        bucket: arAgeBucket(daysPastDue),
        status: item.status,
        risk: daysPastDue > 0 ? "High" : days !== null && days <= 7 ? "Medium" : "Normal",
        owner: "Office Billing",
        detail: `Ready to bill; missing ${item.missingItems || "None"}.`
      };
    });
  return [...paymentRows, ...retainageRows, ...readyRows].sort((a, b) => b.daysPastDue - a.daysPastDue || b.amount - a.amount);
}

function arAgingReport(db) {
  const rows = arAgingRows(db).map(item => {
    const task = (db.tasks || []).find(row => row.source === "AR aging escalation" && (row.relatedId === item.id || row.project === item.project && row.arKind === item.kind));
    const evidence = task ? (db.documents || []).filter(document => document.collectionTaskId === task.id || (task.collectionEvidenceIds || []).includes(document.id)) : [];
    return {
      ...item,
      escalationTask: task?.id || "",
      evidenceCount: evidence.length,
      lastCollectionContact: task?.collectionAttempts?.slice(-1)[0]?.at || "",
      promisedPaymentDate: task?.promisedPaymentDate || "",
      nextFollowUpDate: task?.nextFollowUpDate || ""
    };
  });
  const buckets = ["Current", "1-30", "31-60", "61-90", "90+"].map(bucket => {
    const bucketRows = rows.filter(item => item.bucket === bucket);
    return {
      bucket,
      count: bucketRows.length,
      amount: sum(bucketRows, "amount"),
      highRisk: bucketRows.filter(item => item.risk === "High").length
    };
  });
  return {
    company: db.company,
    generatedAt: new Date().toISOString(),
    summary: {
      count: rows.length,
      amount: sum(rows, "amount"),
      highRisk: rows.filter(item => item.risk === "High").length,
      overdue: rows.filter(item => item.daysPastDue > 0).length
    },
    buckets,
    rows
  };
}

function arAgingCsvRows(report) {
  return report.rows.map(item => ({
    bucket: item.bucket,
    kind: item.kind,
    project: item.project,
    map: item.map,
    invoice: item.invoice,
    amount: item.amount,
    dueDate: item.dueDate,
    daysPastDue: item.daysPastDue,
    status: item.status,
    risk: item.risk,
    owner: item.owner,
    escalationTask: item.escalationTask || "",
    evidenceCount: item.evidenceCount || 0,
    lastCollectionContact: item.lastCollectionContact || "",
    promisedPaymentDate: item.promisedPaymentDate || "",
    nextFollowUpDate: item.nextFollowUpDate || "",
    detail: item.detail
  }));
}

function reportCollectionsPacket(db) {
  const aging = arAgingReport(db);
  const tasks = (db.tasks || [])
    .filter(task => task.source === "AR aging escalation")
    .map(task => {
      const evidence = (db.documents || []).filter(document => document.collectionTaskId === task.id || (task.collectionEvidenceIds || []).includes(document.id));
      const attempts = task.collectionAttempts || [];
      const agingItem = aging.rows.find(row => row.escalationTask === task.id || row.id === task.relatedId || row.project === task.project && row.kind === task.arKind);
      return {
        id: task.id,
        project: task.project,
        map: projectLabel(db, task.project),
        title: task.title,
        owner: task.owner || "",
        status: task.status || "",
        due: task.due || "",
        arKind: task.arKind || agingItem?.kind || "",
        arBucket: task.arBucket || agingItem?.bucket || "",
        arAmount: Number(task.arAmount || agingItem?.amount || 0),
        promisedPaymentDate: task.promisedPaymentDate || "",
        nextFollowUpDate: task.nextFollowUpDate || "",
        disputeReason: task.disputeReason || "",
        notes: task.notes || task.description || "",
        attempts,
        evidence
      };
    });
  const evidence = (db.documents || []).filter(document => document.type === "Collection Communication" || document.collectionTaskId);
  const submissions = db.collectionSubmissions || [];
  const responseRows = collectionResponseRows(db);
  const attempts = tasks.flatMap(task => task.attempts.map(attempt => ({ ...attempt, taskId: task.id, project: task.project, map: task.map })));
  return {
    company: db.company,
    generatedAt: new Date().toISOString(),
    summary: {
      arItems: aging.rows.length,
      arAmount: aging.summary.amount,
      highRisk: aging.summary.highRisk,
      openTasks: tasks.filter(task => task.status !== "Closed").length,
      collectionTasks: tasks.length,
      contactAttempts: attempts.length,
      evidenceRecords: evidence.length,
      squanSubmissions: submissions.length,
      overdueResponses: responseRows.filter(item => ["Overdue", "Promised Past Due"].includes(item.responseStatusComputed)).length,
      pendingResponses: responseRows.filter(item => item.responseStatusComputed === "Pending Response").length,
      escalatedDisputes: responseRows.filter(item => item.responseStatusComputed === "Dispute Escalated").length,
      writeOffReview: responseRows.filter(item => item.responseStatusComputed === "Write-off Review").length,
      writtenOff: responseRows.filter(item => item.responseStatusComputed === "Written Off").length,
      promisedPaymentDates: tasks.filter(task => task.promisedPaymentDate).length,
      disputes: tasks.filter(task => task.disputeReason).length
    },
    aging,
    tasks,
    attempts,
    evidence,
    submissions: responseRows,
    packetLocks: (db.packetLocks || []).filter(lock => lock.scope === "Collections Packet")
  };
}

function reportCollectionsDecisions(db) {
  const submissions = collectionResponseRows(db).filter(item => item.writeOffStatus || item.escalationStatus || item.disputeOutcome || item.adminDecision);
  const decisions = submissions.map(item => {
    const packet = (db.collectionDecisionPackets || []).find(packet => packet.submission === item.id);
    const ledgers = [
      ...(db.invoices || []).filter(invoice => invoice.project === item.project && (invoice.writeOffStatus || invoice.status === "Disputed" || invoice.status === "Write-off approved")),
      ...(db.retainageLedger || []).filter(retainage => retainage.project === item.project && (retainage.writeOffStatus || retainage.status === "Disputed" || retainage.status === "Write-off approved"))
    ];
    const tasks = (db.tasks || []).filter(task => task.relatedId === item.id || task.project === item.project && ["Collections write-off", "Collections dispute", "Collections decision"].includes(task.source));
    const evidence = collectionDecisionEvidenceStatus(db, item);
    return {
      ...item,
      decisionPacket: packet || null,
      evidence,
      ledgerImpact: ledgers.map(row => ({
        id: row.id,
        type: row.invoice ? "Retainage" : "Invoice",
        status: row.status,
        writeOffStatus: row.writeOffStatus || "",
        writeOffAmount: row.writeOffAmount || 0,
        note: row.paymentNote || row.notes || ""
      })),
      tasks: tasks.map(task => ({
        id: task.id,
        title: task.title,
        status: task.status,
        owner: task.owner,
        dueDate: task.dueDate,
        notes: task.notes || ""
      }))
    };
  });
  return {
    company: db.company,
    generatedAt: new Date().toISOString(),
    summary: {
      decisions: decisions.length,
      approvedWriteOffs: decisions.filter(item => item.writeOffStatus === "Approved").length,
      finalizedPackets: (db.collectionDecisionPackets || []).filter(packet => packet.status === "Finalized").length,
      pendingWriteOffs: decisions.filter(item => item.writeOffStatus && item.writeOffStatus !== "Approved").length,
      escalatedDisputes: decisions.filter(item => item.escalationStatus).length,
      evidenceMissing: decisions.reduce((count, item) => count + item.evidence.missing.length, 0),
      evidencePendingReview: decisions.reduce((count, item) => count + item.evidence.rows.filter(row => row.status === "Pending Review").length, 0),
      evidenceRejected: decisions.reduce((count, item) => count + item.evidence.rows.filter(row => row.status === "Rejected").length, 0),
      amountAtRisk: sum(decisions, "amountAtRisk") || sum(decisions, "arExposure"),
      writeOffAmount: sum(decisions, "writeOffAmount")
    },
    decisions,
    decisionPackets: db.collectionDecisionPackets || []
  };
}

function reportBillingTaskCloseouts(db, projectId = "") {
  const rows = (db.billingTaskCloseouts || [])
    .filter(item => !projectId || item.project === projectId)
    .sort((a, b) => String(b.closedAt || "").localeCompare(String(a.closedAt || "")));
  const gapTasks = (db.tasks || [])
    .filter(task => task.source === "Billing closeout gap")
    .filter(task => !projectId || task.project === projectId)
    .sort((a, b) => String(b.modifiedAt || b.createdAt || "").localeCompare(String(a.modifiedAt || a.createdAt || "")));
  const slaTasks = (db.tasks || [])
    .filter(task => task.source === "Billing closeout SLA")
    .filter(task => !projectId || task.project === projectId)
    .sort((a, b) => String(b.modifiedAt || b.createdAt || "").localeCompare(String(a.modifiedAt || a.createdAt || "")));
  const alertControls = (db.alertControls || [])
    .filter(control => control.source === "Billing closeout")
    .filter(control => !projectId || control.project === projectId)
    .sort((a, b) => String(b.modifiedAt || b.createdAt || "").localeCompare(String(a.modifiedAt || a.createdAt || "")));
  const readiness = projectId ? billingCloseoutSubmissionReadiness(db, projectId) : null;
  return {
    company: db.company,
    generatedAt: new Date().toISOString(),
    project: projectId || "All",
    summary: {
      closeouts: rows.length,
      invoiceValue: rows.reduce((total, item) => total + Number(item.invoice?.gross || 0), 0),
      paid90: rows.reduce((total, item) => total + Number(item.invoice?.paid90 || 0), 0),
      retainageHeld: rows.reduce((total, item) => total + Number(item.retainage?.heldAmount || item.invoice?.retainage10 || 0), 0),
      cashReceipts: rows.reduce((total, item) => total + (item.receipts || []).length, 0),
      evidenceDocuments: rows.reduce((total, item) => total + (item.evidence || []).length, 0),
      gapTasks: gapTasks.length,
      openGapTasks: gapTasks.filter(task => task.status !== "Closed").length,
      slaTasks: slaTasks.length,
      openSlaTasks: slaTasks.filter(task => task.status !== "Closed").length,
      acceptedReviews: rows.filter(item => item.adminReview?.status === "Accepted").length,
      finalAcceptedReviews: rows.filter(item => item.finalizedStatus === "Final Accepted").length,
      returnedReviews: rows.filter(item => item.adminReview?.status === "Returned").length,
      escalatedReviews: rows.filter(item => item.adminReview?.status === "Escalated").length,
      alertControls: alertControls.length,
      activeAlertControls: alertControls.filter(control => control.status === "Active").length,
      snoozedAlerts: alertControls.filter(control => control.kind === "Snoozed").length,
      dismissedAlerts: alertControls.filter(control => control.kind === "Dismissed").length,
      reactivatedAlerts: alertControls.filter(control => control.status === "Reactivated").length,
      submissionReadiness: readiness?.status || "All"
    },
    submissionReadiness: readiness,
    closeouts: rows,
    gapTasks,
    slaTasks,
    alertControls
  };
}

function financialCloseoutRows(db, projectId = "") {
  return (db.projects || [])
    .filter(project => !projectId || project.id === projectId)
    .map(project => {
      const invoice = (db.invoices || []).find(item => item.project === project.id);
      const submission = (db.invoiceSubmissions || []).find(item => item.project === project.id || item.invoice === invoice?.id);
      const retainage = (db.retainageLedger || []).find(item => item.project === project.id || item.invoice === invoice?.id);
      const receipts = (db.cashReceipts || []).filter(item => item.project === project.id || item.invoice === invoice?.id || item.submission === submission?.id || item.retainage === retainage?.id);
      const tasks = (db.tasks || []).filter(task => task.project === project.id && task.source === "Financial closeout gate");
      const record = project.adminApprovals?.financialCloseout || project.adminApprovals?.closeout || null;
      const gateSnapshot = record?.gateSnapshot || [];
      const blockers = gateSnapshot.filter(item => !item.ok);
      const approvalEvents = (project.approvalLog || []).filter(item => ["financial-closeout", "close-map", "reopen-financial-closeout"].includes(item.decision));
      return {
        project: project.id,
        map: project.map || project.id,
        status: record?.status || (blockers.length ? "Blocked" : "Pending"),
        closedAt: record?.at || project.closedAt || "",
        closedBy: record?.by || "",
        reason: record?.reason || "",
        reopenedAt: record?.reopenedAt || "",
        reopenedBy: record?.reopenedBy || "",
        reopenReason: record?.reopenReason || "",
        invoice: invoice?.id || record?.invoice || "",
        invoiceStatus: invoice?.status || "",
        invoiceGross: invoice?.gross || 0,
        paid90: invoice?.paid90 || 0,
        submission: submission?.id || record?.submission || "",
        confirmationNumber: submission?.confirmationNumber || submission?.receipt?.confirmationNumber || "",
        retainage: retainage?.id || record?.retainage || "",
        retainageStatus: retainage?.status || "",
        retainageHeld: retainage?.heldAmount || invoice?.retainage10 || 0,
        receipts: receipts.map(item => item.id),
        receiptStatuses: receipts.map(item => `${item.id}:${item.depositStatus || item.status}`).join("; "),
        gateSnapshot,
        gateBlockers: blockers.map(item => item.label || item.key),
        openFinancialTasks: tasks.filter(task => task.status !== "Closed").map(task => task.id),
        approvalEvents
      };
    })
    .filter(row => row.status !== "Pending" || row.invoice || row.submission || row.retainage || row.receipts.length || row.openFinancialTasks.length);
}

function reportFinancialCloseouts(db, projectId = "") {
  const rows = financialCloseoutRows(db, projectId);
  return {
    company: db.company,
    generatedAt: new Date().toISOString(),
    project: projectId || "All",
    summary: {
      rows: rows.length,
      closed: rows.filter(row => row.status === "Closed").length,
      reopened: rows.filter(row => row.status === "Reopened").length,
      blocked: rows.filter(row => row.gateBlockers.length).length,
      receipts: rows.reduce((total, row) => total + row.receipts.length, 0),
      retainageHeld: rows.reduce((total, row) => total + Number(row.retainageStatus === "Released / Paid" || row.retainageStatus === "Paid" ? 0 : row.retainageHeld || 0), 0),
      openFinancialTasks: rows.reduce((total, row) => total + row.openFinancialTasks.length, 0)
    },
    closeouts: rows
  };
}

function financialCloseoutCsvRows(report) {
  return report.closeouts.map(row => ({
    project: row.project,
    map: row.map,
    status: row.status,
    closedAt: row.closedAt,
    closedBy: row.closedBy,
    reason: row.reason,
    reopenedAt: row.reopenedAt,
    reopenedBy: row.reopenedBy,
    reopenReason: row.reopenReason,
    invoice: row.invoice,
    invoiceStatus: row.invoiceStatus,
    invoiceGross: row.invoiceGross,
    paid90: row.paid90,
    submission: row.submission,
    confirmationNumber: row.confirmationNumber,
    retainage: row.retainage,
    retainageStatus: row.retainageStatus,
    retainageHeld: row.retainageHeld,
    receipts: row.receipts.join("; "),
    receiptStatuses: row.receiptStatuses,
    gateBlockers: row.gateBlockers.join("; "),
    openFinancialTasks: row.openFinancialTasks.join("; "),
    approvalEvents: row.approvalEvents.map(item => `${item.decision}:${item.status}:${item.at}:${item.by}`).join("; ")
  }));
}

function reportCloseoutReadinessBreaches(db, projectId = "") {
  const projects = (db.projects || []).filter(project => !projectId || project.id === projectId);
  const rows = closeoutReadinessAgingRows(db, projects)
    .filter(row => row.needsEscalation || row.severity === "Critical" || row.severity === "High");
  const policy = closeoutReadinessSlaDefaults(db.company || {});
  return {
    company: db.company,
    generatedAt: new Date().toISOString(),
    project: projectId || "All",
    policy,
    summary: {
      breaches: rows.length,
      critical: rows.filter(row => row.severity === "Critical").length,
      high: rows.filter(row => row.severity === "High").length,
      ownerMismatch: rows.filter(row => row.ownerMismatch).length,
      staleHandoff: rows.filter(row => row.staleHandoff).length,
      overdue: rows.filter(row => row.overdue).length
    },
    breaches: rows
  };
}

function closeoutReadinessAgingRows(db, projects = db.projects || []) {
  const projectIds = new Set(projects.map(project => project.id));
  const policy = closeoutReadinessSlaDefaults(db.company || {});
  return (db.tasks || [])
    .filter(task => task.source === "Billing closeout readiness" && task.status !== "Closed")
    .filter(task => !projectIds.size || projectIds.has(task.project))
    .map(task => {
      const project = projects.find(item => item.id === task.project) || (db.projects || []).find(item => item.id === task.project) || { id: task.project, map: task.project };
      const readiness = billingCloseoutSubmissionReadiness(db, project.id);
      const item = closeoutReadinessTaskItem(task, readiness);
      const handoff = closeoutReadinessHandoffConfig(item);
      const dueDays = daysUntil(task.dueDate);
      const taskAge = ageDays(task.createdAt || task.modifiedAt || task.dueDate) || 0;
      const handoffRows = (task.activityLog || []).filter(log => String(log.note || "").includes("Closeout readiness handoff"));
      const lastHandoff = handoffRows.at(-1);
      const handoffAge = lastHandoff ? ageDays(lastHandoff.at) || 0 : null;
      const ownerMismatch = task.owner !== handoff.owner;
      const overdue = dueDays !== 9999 && dueDays < 0;
      const warningTask = taskAge >= policy.warningDays;
      const staleHandoff = handoffAge !== null && handoffAge >= policy.handoffAgingDays;
      const staleTask = taskAge >= policy.escalationDays;
      const ownerMismatchEscalates = policy.ownerMismatchEscalates === "Yes" && ownerMismatch;
      const needsEscalation = overdue || staleHandoff || staleTask || ownerMismatchEscalates;
      const severity = overdue || staleTask ? "Critical" : staleHandoff || ownerMismatchEscalates ? "High" : ownerMismatch || warningTask ? "Medium" : "Info";
      const status = overdue ? "Overdue" : staleHandoff ? "Handoff Aging" : ownerMismatch ? "Owner Mismatch" : staleTask ? "Aging" : "Current";
      const detail = overdue
        ? `Due ${task.dueDate}; ${Math.abs(dueDays)} day(s) overdue.`
        : ownerMismatch
          ? `Assigned to ${task.owner || "Unassigned"}; recommended owner is ${handoff.owner}.`
          : staleHandoff
            ? `Last handoff is ${handoffAge} day(s) old.`
            : `Open ${taskAge} day(s); due ${task.dueDate || "N/A"}.`;
      return {
        taskId: task.id,
        taskTitle: task.title || "",
        taskStatus: task.status || "",
        project: project.id,
        map: project.map || project.id,
        customer: project.customer || "",
        blockerKey: item.key || "",
        blockerLabel: item.label || task.title || "",
        blockerDetail: item.detail || task.notes || "",
        currentOwner: task.owner || "",
        recommendedOwner: handoff.owner,
        recommendedRole: handoff.role,
        dueDate: task.dueDate || "",
        createdAt: task.createdAt || "",
        modifiedAt: task.modifiedAt || "",
        taskAge,
        handoffAge: handoffAge ?? "",
        ownerMismatch,
        ownerMismatchEscalates,
        overdue,
        warningTask,
        staleHandoff,
        staleTask,
        needsEscalation,
        severity,
        status,
        detail,
        handoffHistory: handoffRows.map(log => `${log.at || ""}:${log.by || ""}:${log.note || ""}`).join(" | ")
      };
    })
    .sort((a, b) => {
      const rank = { Critical: 0, High: 1, Medium: 2, Info: 3 };
      return (rank[a.severity] ?? 4) - (rank[b.severity] ?? 4) || daysUntil(a.dueDate) - daysUntil(b.dueDate);
    });
}

function closeoutReadinessTaskItem(task, readiness) {
  const key = task.closeoutReadinessKey || task.readinessKey || task.extra?.readinessKey;
  return (readiness?.items || []).find(item => item.key === key) || {
    key: key || "closeout-readiness",
    label: task.title || "Closeout readiness blocker",
    status: task.status || "Open",
    detail: task.notes || "Review the closeout readiness gate for this Map."
  };
}

function closeoutReadinessHandoffConfig(item = {}) {
  const key = item.key || "";
  if (key === "final-accepted-closeout" || key === "no-pending-final-review" || key === "closeout-alerts-reviewed") {
    return { owner: "Ronald Jackson", role: "Admin" };
  }
  return { owner: "Office Billing", role: "Billing" };
}

function billingCloseoutSubmissionReadiness(db, projectId) {
  const closeouts = (db.billingTaskCloseouts || []).filter(item => item.project === projectId);
  const controls = (db.alertControls || []).filter(control => control.source === "Billing closeout" && control.project === projectId && control.status === "Active");
  const openReopenTasks = (db.tasks || []).filter(task => task.project === projectId && task.source === "Billing closeout final reopen" && task.status !== "Closed");
  const finalAccepted = closeouts.filter(item => item.finalizedStatus === "Final Accepted");
  const reopened = closeouts.filter(item => item.finalizedStatus === "Reopened" || item.adminReview?.status === "Reopened");
  const pendingFinal = closeouts.filter(item => item.finalizedStatus === "Pending Final Review");
  const correctionEvidence = closeouts.flatMap(closeout => closeout.correctionEvidence || []);
  const rejectedEvidence = correctionEvidence.filter(item => item.status === "Rejected" && !item.replacedBy);
  const pendingEvidence = correctionEvidence.filter(item => ["Submitted", "Pending Review", "Needs Review"].includes(item.status || ""));
  const items = [
    { key: "final-accepted-closeout", label: "Final accepted closeout", ok: finalAccepted.length > 0, status: finalAccepted.length ? "Final Accepted" : closeouts.length === 0 ? "No Closeout" : "Blocked", detail: finalAccepted.length ? `${finalAccepted.length} final accepted closeout(s).` : closeouts.length === 0 ? "No Billing closeout snapshot exists yet." : "No closeout has been final accepted." },
    { key: "no-reopened-closeouts", label: "No reopened closeouts", ok: reopened.length === 0, status: reopened.length ? "Blocked" : "Clear", detail: reopened.length ? `${reopened.length} closeout(s) reopened and not final accepted.` : "No reopened closeouts." },
    { key: "no-pending-final-review", label: "No pending final review", ok: pendingFinal.length === 0, status: pendingFinal.length ? "Pending Review" : "Clear", detail: pendingFinal.length ? `${pendingFinal.length} closeout(s) awaiting Admin final acceptance.` : "No closeouts are pending final review." },
    { key: "correction-evidence-clear", label: "Correction evidence clear", ok: rejectedEvidence.length === 0 && pendingEvidence.length === 0, status: rejectedEvidence.length ? "Rejected" : pendingEvidence.length ? "Pending Review" : "Clear", detail: rejectedEvidence.length ? `${rejectedEvidence.length} rejected evidence item(s).` : pendingEvidence.length ? `${pendingEvidence.length} evidence item(s) waiting on Admin review.` : "No rejected or pending correction evidence." },
    { key: "reopen-tasks-closed", label: "Reopen tasks closed", ok: openReopenTasks.length === 0, status: openReopenTasks.length ? "Open" : "Closed", detail: openReopenTasks.length ? `${openReopenTasks.length} reopen task(s) still open.` : "No open closeout reopen tasks." },
    { key: "closeout-alerts-reviewed", label: "Closeout alerts reviewed", ok: controls.length === 0, status: controls.length ? "Needs Review" : "Clear", detail: controls.length ? `${controls.length} active closeout alert control(s) must be reviewed before submission/export.` : "No active closeout alert snoozes or dismissals." }
  ];
  const blockers = items.filter(item => !item.ok);
  return {
    ready: blockers.length === 0,
    status: blockers.length ? "Blocked" : "Ready to submit",
    items,
    blockers
  };
}

function billingTaskCloseoutCsvRows(report) {
  const closeoutRows = report.closeouts.map(item => ({
    rowType: "Closeout",
    closeoutId: item.id,
    task: item.task,
    taskTitle: item.taskTitle,
    project: item.project,
    map: item.map || "",
    billingKind: item.billingKind || item.category || "",
    closedAt: item.closedAt,
    closedBy: item.closedBy,
    invoice: item.invoice?.id || "",
    invoiceStatus: item.invoice?.status || "",
    invoiceGross: item.invoice?.gross || 0,
    paid90: item.invoice?.paid90 || 0,
    submission: item.submission?.id || "",
    confirmationNumber: item.submission?.confirmationNumber || "",
    submissionStatus: item.submission?.status || "",
    followUpDate: item.submission?.followUpDate || "",
    responseStatus: item.submission?.responseStatus || "",
    promisedPaymentDate: item.submission?.promisedPaymentDate || "",
    disputeOutcome: item.submission?.disputeOutcome || "",
    adminReviewStatus: item.adminReview?.status || "Pending",
    adminReviewBy: item.adminReview?.by || "",
    adminReviewAt: item.adminReview?.at || "",
    adminReviewNote: item.adminReview?.note || "",
    finalizedStatus: item.finalizedStatus || "",
    finalizedAt: item.finalizedAt || "",
    finalizedBy: item.finalizedBy || "",
    reopenedAt: item.reopenedAt || "",
    reopenedBy: item.reopenedBy || "",
    reopenReason: item.reopenReason || "",
    finalizationEvents: (item.finalizationHistory || []).map(event => `${event.status}:${event.at}:${event.by}`).join("; "),
    closeoutTimeline: billingCloseoutTimelineCsv(item),
    lockedCorrectionEvidence: (item.correctionEvidence || []).filter(document => document.locked === "Yes").map(document => document.id).join("; "),
    resubmissions: (item.resubmissionLog || []).length,
    latestResubmissionAt: (item.resubmissionLog || []).at(-1)?.at || "",
    latestResubmissionBy: (item.resubmissionLog || []).at(-1)?.by || "",
    latestResubmissionNote: (item.resubmissionLog || []).at(-1)?.note || "",
    retainage: item.retainage?.id || "",
    retainageStatus: item.retainage?.status || "",
    retainageHeld: item.retainage?.heldAmount || 0,
    retainageRelease: item.retainage?.releaseDate || "",
    cashReceipts: (item.receipts || []).map(receipt => receipt.id).join("; "),
    cashReceived: (item.receipts || []).reduce((total, receipt) => total + Number(receipt.actualAmount || 0), 0),
    evidence: (item.evidence || []).map(document => `${document.id}:${document.status}`).join("; "),
    correctionEvidence: (item.correctionEvidence || []).map(document => `${document.id}:${document.newSinceReturn || ""}`).join("; "),
    currentCorrectionEvidence: (item.correctionEvidence || []).filter(document => !document.replacedBy && document.status !== "Rejected").map(document => `${document.id}:${document.status || ""}`).join("; "),
    priorCorrectionEvidence: (item.correctionEvidence || []).filter(document => document.replacedBy || document.status === "Rejected").map(document => `${document.id}:${document.status || ""}${document.replacedBy ? `->${document.replacedBy}` : ""}`).join("; "),
    evidenceSummary: item.evidenceSummary || "",
    alertId: "",
    alertControlKind: "",
    alertControlStatus: "",
    alertControlRevision: "",
    alertControlUpdatedBy: "",
    snoozedUntil: "",
    dismissedAt: "",
    reactivatedAt: "",
    readinessStatus: "",
    readinessLabel: "",
    readinessDetail: "",
    gapItems: "",
    resolvedBy: ""
  }));
  const gapRows = (report.gapTasks || []).map(task => ({
    rowType: "Gap Task",
    closeoutId: task.billingCloseoutId || "",
    task: task.id,
    taskTitle: task.title,
    project: task.project,
    map: "",
    billingKind: "Gap",
    closedAt: task.status === "Closed" ? task.modifiedAt || "" : "",
    closedBy: "",
    invoice: task.invoice || "",
    invoiceStatus: "",
    invoiceGross: "",
    paid90: "",
    submission: task.submission || "",
    confirmationNumber: "",
    submissionStatus: "",
    followUpDate: "",
    responseStatus: "",
    promisedPaymentDate: "",
    disputeOutcome: "",
    adminReviewStatus: "",
    adminReviewBy: "",
    adminReviewAt: "",
    adminReviewNote: "",
    finalizedStatus: "",
    finalizedAt: "",
    finalizedBy: "",
    reopenedAt: "",
    reopenedBy: "",
    reopenReason: "",
    finalizationEvents: "",
    closeoutTimeline: "",
    lockedCorrectionEvidence: "",
    resubmissions: "",
    latestResubmissionAt: "",
    latestResubmissionBy: "",
    latestResubmissionNote: "",
    retainage: task.retainage || "",
    retainageStatus: "",
    retainageHeld: "",
    retainageRelease: "",
    cashReceipts: "",
    cashReceived: "",
    evidence: "",
    correctionEvidence: "",
    currentCorrectionEvidence: "",
    priorCorrectionEvidence: "",
    evidenceSummary: task.notes || "",
    alertId: "",
    alertControlKind: "",
    alertControlStatus: "",
    alertControlRevision: "",
    alertControlUpdatedBy: "",
    snoozedUntil: "",
    dismissedAt: "",
    reactivatedAt: "",
    readinessStatus: "",
    readinessLabel: "",
    readinessDetail: "",
    gapItems: (task.closeoutGapItems || []).join("; "),
    resolvedBy: task.billingCloseoutId || ""
  }));
  const slaRows = (report.slaTasks || []).map(task => ({
    rowType: "SLA Task",
    closeoutId: task.billingCloseoutId || "",
    task: task.id,
    taskTitle: task.title,
    project: task.project,
    map: "",
    billingKind: "SLA",
    closedAt: task.status === "Closed" ? task.modifiedAt || "" : "",
    closedBy: "",
    invoice: task.invoice || "",
    invoiceStatus: "",
    invoiceGross: "",
    paid90: "",
    submission: task.submission || "",
    confirmationNumber: "",
    submissionStatus: "",
    followUpDate: "",
    responseStatus: "",
    promisedPaymentDate: "",
    disputeOutcome: "",
    adminReviewStatus: "",
    adminReviewBy: "",
    adminReviewAt: "",
    adminReviewNote: "",
    finalizedStatus: "",
    finalizedAt: "",
    finalizedBy: "",
    reopenedAt: "",
    reopenedBy: "",
    reopenReason: "",
    finalizationEvents: "",
    closeoutTimeline: "",
    lockedCorrectionEvidence: "",
    resubmissions: "",
    latestResubmissionAt: "",
    latestResubmissionBy: "",
    latestResubmissionNote: "",
    retainage: task.retainage || "",
    retainageStatus: "",
    retainageHeld: "",
    retainageRelease: "",
    cashReceipts: "",
    cashReceived: "",
    evidence: "",
    correctionEvidence: "",
    currentCorrectionEvidence: "",
    priorCorrectionEvidence: "",
    evidenceSummary: task.notes || "",
    alertId: "",
    alertControlKind: "",
    alertControlStatus: "",
    alertControlRevision: "",
    alertControlUpdatedBy: "",
    snoozedUntil: "",
    dismissedAt: "",
    reactivatedAt: "",
    readinessStatus: "",
    readinessLabel: "",
    readinessDetail: "",
    gapItems: "",
    resolvedBy: task.billingCloseoutId || ""
  }));
  const alertRows = (report.alertControls || []).map(control => ({
    rowType: "Alert Control",
    closeoutId: String(control.alertId || "").split(":")[1] || "",
    task: "",
    taskTitle: control.notes || "",
    project: control.project || "",
    map: "",
    billingKind: "Alert Control",
    closedAt: control.modifiedAt || control.createdAt || "",
    closedBy: control.updatedBy || "",
    invoice: "",
    invoiceStatus: "",
    invoiceGross: "",
    paid90: "",
    submission: "",
    confirmationNumber: "",
    submissionStatus: "",
    followUpDate: "",
    responseStatus: "",
    promisedPaymentDate: "",
    disputeOutcome: "",
    adminReviewStatus: "",
    adminReviewBy: "",
    adminReviewAt: "",
    adminReviewNote: "",
    finalizedStatus: "",
    finalizedAt: "",
    finalizedBy: "",
    reopenedAt: "",
    reopenedBy: "",
    reopenReason: "",
    finalizationEvents: "",
    closeoutTimeline: "",
    lockedCorrectionEvidence: "",
    resubmissions: "",
    latestResubmissionAt: "",
    latestResubmissionBy: "",
    latestResubmissionNote: "",
    retainage: "",
    retainageStatus: "",
    retainageHeld: "",
    retainageRelease: "",
    cashReceipts: "",
    cashReceived: "",
    evidence: "",
    correctionEvidence: "",
    currentCorrectionEvidence: "",
    priorCorrectionEvidence: "",
    evidenceSummary: control.notes || "",
    alertId: control.alertId || "",
    alertControlKind: control.kind || "",
    alertControlStatus: control.status || "",
    alertControlRevision: control.revision || "",
    alertControlUpdatedBy: control.updatedBy || "",
    snoozedUntil: control.snoozedUntil || "",
    dismissedAt: control.dismissedAt || "",
    reactivatedAt: control.reactivatedAt || "",
    readinessStatus: "",
    readinessLabel: "",
    readinessDetail: "",
    gapItems: "",
    resolvedBy: ""
  }));
  const readinessRows = (report.submissionReadiness?.items || []).map(item => ({
    rowType: "Submission Readiness",
    closeoutId: "",
    task: "",
    taskTitle: item.label,
    project: report.project || "",
    map: "",
    billingKind: "Readiness Gate",
    closedAt: "",
    closedBy: "",
    invoice: "",
    invoiceStatus: "",
    invoiceGross: "",
    paid90: "",
    submission: "",
    confirmationNumber: "",
    submissionStatus: "",
    followUpDate: "",
    responseStatus: "",
    promisedPaymentDate: "",
    disputeOutcome: "",
    adminReviewStatus: "",
    adminReviewBy: "",
    adminReviewAt: "",
    adminReviewNote: "",
    finalizedStatus: "",
    finalizedAt: "",
    finalizedBy: "",
    reopenedAt: "",
    reopenedBy: "",
    reopenReason: "",
    finalizationEvents: "",
    closeoutTimeline: "",
    lockedCorrectionEvidence: "",
    resubmissions: "",
    latestResubmissionAt: "",
    latestResubmissionBy: "",
    latestResubmissionNote: "",
    retainage: "",
    retainageStatus: "",
    retainageHeld: "",
    retainageRelease: "",
    cashReceipts: "",
    cashReceived: "",
    evidence: "",
    correctionEvidence: "",
    currentCorrectionEvidence: "",
    priorCorrectionEvidence: "",
    evidenceSummary: item.detail || "",
    alertId: "",
    alertControlKind: "",
    alertControlStatus: "",
    alertControlRevision: "",
    alertControlUpdatedBy: "",
    snoozedUntil: "",
    dismissedAt: "",
    reactivatedAt: "",
    readinessStatus: item.status || "",
    readinessLabel: item.label || "",
    readinessDetail: item.detail || "",
    gapItems: "",
    resolvedBy: item.ok ? "Ready" : "Blocked"
  }));
  return [...readinessRows, ...closeoutRows, ...gapRows, ...slaRows, ...alertRows];
}

function billingCloseoutTimelineCsv(closeout = {}) {
  const events = [];
  const add = (at, status, title, by) => {
    if (!at && !title) return;
    events.push({
      at: at || "",
      status: status || "Updated",
      title: title || "Closeout updated",
      by: by || "System"
    });
  };
  add(closeout.closedAt, "Closed", "Billing task closed", closeout.closedBy);
  if (closeout.adminReview?.status) add(closeout.adminReview.at, closeout.adminReview.status, `Admin review ${closeout.adminReview.status}`, closeout.adminReview.by);
  (closeout.finalizationHistory || []).forEach(event => add(event.at, event.status, event.status === "Reopened" ? "Final closeout reopened" : "Final closeout accepted", event.by));
  (closeout.resubmissionLog || []).forEach(event => add(event.at, "Pending Review", "Closeout resubmitted", event.by));
  (closeout.correctionEvidence || []).forEach(document => {
    add(document.attachedAt, "Submitted", `Evidence attached ${document.id}`, document.attachedBy);
    if (document.reviewedAt) add(document.reviewedAt, document.status, `Evidence ${String(document.status || "reviewed").toLowerCase()} ${document.id}`, document.reviewedBy);
    if (document.supersededAt || document.replacedBy) add(document.supersededAt || document.modifiedAt, "Replaced", `Evidence replaced ${document.id}`, document.attachedBy);
    if (document.locked === "Yes") add(document.modifiedAt || closeout.finalizedAt, "Locked", `Evidence locked ${document.id}`, closeout.finalizedBy || document.reviewedBy);
    if (document.unlockedAt) add(document.unlockedAt, "Reopened", `Evidence unlocked ${document.id}`, document.unlockedBy);
  });
  if (closeout.reopenedAt && !(closeout.finalizationHistory || []).some(event => event.status === "Reopened" && event.at === closeout.reopenedAt)) {
    add(closeout.reopenedAt, "Reopened", "Final closeout reopened", closeout.reopenedBy);
  }
  if (closeout.finalizedAt && !(closeout.finalizationHistory || []).some(event => event.status === "Final Accepted" && event.at === closeout.finalizedAt)) {
    add(closeout.finalizedAt, "Final Accepted", "Final closeout accepted", closeout.finalizedBy);
  }
  return events
    .sort((a, b) => String(a.at || "").localeCompare(String(b.at || "")))
    .map(event => `${event.at}:${event.status}:${event.title}:${event.by}`)
    .join(" | ");
}

function collectionDecisionEvidenceRequirements(submission) {
  const requirements = [
    { key: "squan-response", label: "SQUAN email / portal response" },
    { key: "amount-calculation", label: "Amount calculation / ledger impact" }
  ];
  if (submission.escalationStatus || submission.disputeOutcome) requirements.push({ key: "dispute-support", label: "Dispute support / SQUAN position" });
  if (submission.writeOffStatus || submission.writeOffAmount) requirements.push({ key: "admin-approval-memo", label: "Admin approval memo" });
  if (String(submission.disputeOutcome || submission.responseNote || "").toLowerCase().includes("quantity")) requirements.push({ key: "quantity-comparison", label: "Quantity comparison" });
  if (String(submission.disputeOutcome || submission.responseNote || "").toLowerCase().includes("chargeback")) requirements.push({ key: "chargeback-notice", label: "Chargeback notice" });
  if (String(submission.disputeOutcome || submission.responseNote || "").toLowerCase().includes("retainage")) requirements.push({ key: "retainage-rejection", label: "Retainage rejection / release note" });
  return requirements;
}

function collectionDecisionEvidenceStatus(db, submission) {
  const docs = (db.documents || []).filter(document => document.collectionSubmissionId === submission.id || document.relatedCollectionSubmission === submission.id);
  const rows = collectionDecisionEvidenceRequirements(submission).map(requirement => {
    const document = docs
      .filter(item => item.decisionEvidenceKey === requirement.key)
      .sort((a, b) => String(b.modifiedAt || b.uploadedAt || "").localeCompare(String(a.modifiedAt || a.uploadedAt || "")))[0];
    const status = document?.decisionEvidenceStatus || document?.status || "Missing";
    const ready = status === "Accepted";
    return {
      ...requirement,
      ready: Boolean(ready),
      documentId: document?.id || "",
      status,
      reviewedBy: document?.decisionEvidenceReviewedBy || document?.reviewedBy || "",
      reviewedAt: document?.decisionEvidenceReviewedAt || document?.reviewedAt || "",
      reviewNotes: document?.reviewNotes || "",
      version: document?.decisionEvidenceVersion || 1,
      versionHistory: document?.decisionEvidenceVersions || []
    };
  });
  return {
    total: rows.length,
    ready: rows.filter(item => item.ready).length,
    missing: rows.filter(item => !item.ready),
    rows
  };
}

function collectionResponseRows(db) {
  return (db.collectionSubmissions || []).map(item => {
    const followUpDays = daysUntil(item.nextFollowUpDate);
    const promisedDays = daysUntil(item.promisedPaymentDate);
    const hasResponse = Boolean(item.responseStatus || item.responseAt || item.promisedPaymentDate || item.disputeOutcome);
    const responseStatusComputed = item.status === "Closed"
      ? "Closed"
      : item.writeOffStatus === "Approved"
        ? "Written Off"
        : item.writeOffStatus
          ? "Write-off Review"
          : item.escalationStatus
            ? "Dispute Escalated"
            : item.cashReceiptId || item.cashStatus === "Received"
              ? "Cash Received"
              : item.disputeOutcome
                ? "Disputed"
                : item.promisedPaymentDate
                  ? promisedDays !== null && promisedDays < 0 ? "Promised Past Due" : "Payment Promised"
                  : !hasResponse && followUpDays !== null && followUpDays < 0
                    ? "Overdue"
                    : !hasResponse
                      ? "Pending Response"
                      : item.nextFollowUpDate
                        ? "Follow-up Scheduled"
                        : "Response Received";
    return {
      ...item,
      map: item.map || projectLabel(db, item.project),
      followUpDays,
      promisedDays,
      responseStatusComputed
    };
  });
}

function collectionsDecisionCsvRows(report) {
  return report.decisions.map(item => ({
    reference: item.id,
    project: item.project,
    map: item.map || "",
    status: item.responseStatusComputed || item.status || "",
    amountAtRisk: item.amountAtRisk || item.arExposure || "",
    writeOffAmount: item.writeOffAmount || "",
    writeOffStatus: item.writeOffStatus || "",
    escalationStatus: item.escalationStatus || "",
    adminDecision: item.adminDecision || "",
    decisionPacket: item.decisionPacket?.id || item.decisionPacketId || "",
    packetFinalizedAt: item.decisionPacket?.finalizedAt || "",
    packetFinalizedBy: item.decisionPacket?.finalizedBy || "",
    adminDecisionBy: item.adminDecisionBy || item.writeOffApprovedBy || item.writeOffRequestedBy || "",
    adminDecisionAt: item.adminDecisionAt || item.writeOffApprovedAt || item.writeOffRequestedAt || "",
    evidenceReady: item.evidence?.ready || 0,
    evidenceTotal: item.evidence?.total || 0,
    evidenceMissing: (item.evidence?.missing || []).map(row => row.label).join("; "),
    evidencePendingReview: (item.evidence?.rows || []).filter(row => row.status === "Pending Review").map(row => row.label).join("; "),
    evidenceRejected: (item.evidence?.rows || []).filter(row => row.status === "Rejected").map(row => row.label).join("; "),
    evidenceReviewedBy: (item.evidence?.rows || []).filter(row => row.reviewedBy).map(row => `${row.label}: ${row.reviewedBy}`).join("; "),
    evidenceVersions: (item.evidence?.rows || []).map(row => `${row.label}: v${row.version || 1}${row.versionHistory?.length ? ` (${row.versionHistory.length} prior)` : ""}`).join("; "),
    ledgerRows: item.ledgerImpact?.length || 0,
    taskRows: item.tasks?.length || 0,
    reason: item.adminDecisionNote || item.writeOffReason || item.disputeOutcome || item.responseNote || ""
  }));
}

function collectionsPacketCsvRows(report) {
  const agingRows = report.aging.rows.map(item => ({
    rowType: "AR Aging",
    reference: item.id,
    project: item.project,
    map: item.map,
    invoice: item.invoice,
    status: item.status,
    amount: item.amount,
    dueDate: item.dueDate,
    owner: item.owner,
    promisedPaymentDate: item.promisedPaymentDate || "",
    nextFollowUpDate: item.nextFollowUpDate || "",
    detail: item.detail
  }));
  const taskRows = report.tasks.map(task => ({
    rowType: "Collection Task",
    reference: task.id,
    project: task.project,
    map: task.map,
    invoice: "",
    status: task.status,
    amount: task.arAmount,
    dueDate: task.due,
    owner: task.owner,
    promisedPaymentDate: task.promisedPaymentDate,
    nextFollowUpDate: task.nextFollowUpDate,
    detail: [task.title, task.disputeReason ? `Dispute: ${task.disputeReason}` : "", task.notes].filter(Boolean).join(" | ")
  }));
  const attemptRows = report.attempts.map(attempt => ({
    rowType: "Contact Attempt",
    reference: attempt.taskId,
    project: attempt.project,
    map: attempt.map,
    invoice: "",
    status: attempt.method || "Contact",
    amount: "",
    dueDate: attempt.at || "",
    owner: attempt.by || "",
    promisedPaymentDate: "",
    nextFollowUpDate: attempt.nextFollowUpDate || "",
    detail: attempt.note || ""
  }));
  const evidenceRows = report.evidence.map(document => ({
    rowType: "Communication Evidence",
    reference: document.id,
    project: document.project || "",
    map: document.map || document.project || "",
    invoice: document.relatedInvoice || "",
    status: document.status || "Filed",
    amount: "",
    dueDate: document.createdAt || document.updatedAt || "",
    owner: document.author || document.uploadedBy || "",
    promisedPaymentDate: "",
    nextFollowUpDate: document.nextFollowUpDate || "",
    detail: document.communicationNote || document.notes || document.path || document.name || ""
  }));
  const submissionRows = (report.submissions || []).map(submission => ({
    rowType: "SQUAN Submission",
    reference: submission.id,
    project: submission.project,
    map: submission.map || "",
    invoice: "",
    status: submission.status || "Sent",
    amount: submission.arExposure || "",
    dueDate: submission.nextFollowUpDate || submission.promisedPaymentDate || "",
    owner: submission.submittedBy || "",
    promisedPaymentDate: submission.promisedPaymentDate || "",
    nextFollowUpDate: submission.nextFollowUpDate || "",
    detail: [submission.responseStatusComputed, submission.sentTo, submission.method, submission.confirmationNumber, submission.responseStatus, submission.responseNote, submission.disputeOutcome, submission.escalationStatus, submission.writeOffStatus, submission.writeOffAmount ? `write-off ${submission.writeOffAmount}` : ""].filter(Boolean).join(" | ")
  }));
  return [...agingRows, ...taskRows, ...attemptRows, ...evidenceRows, ...submissionRows];
}

function forecastWeekBuckets(db, inflows, outflows, startingCash) {
  let runningCash = startingCash;
  return Array.from({ length: 13 }, (_, index) => {
    const start = addDays(todayIso(), index * 7);
    const end = addDays(todayIso(), index * 7 + 6);
    const items = inflows.filter(item => item.expectedDate >= start && item.expectedDate <= end);
    const costs = outflows.filter(item => item.expectedDate >= start && item.expectedDate <= end);
    const inflow = sum(items, "amount");
    const outflow = sum(costs, "amount");
    runningCash += inflow - outflow;
    return { index: index + 1, start, end, inflow, outflow, net: inflow - outflow, runningCash, belowThreshold: runningCash < Number(db.company?.minimumCashThreshold || 0) };
  });
}

function cashForecastCsvRows(report) {
  const bucketRows = report.buckets.map(item => ({
    rowType: "Week bucket",
    reference: `Week ${item.index}`,
    project: "",
    map: "",
    date: `${item.start} to ${item.end}`,
    status: item.belowThreshold ? "Below threshold" : "Above threshold",
    amount: item.net,
    detail: `In ${item.inflow}; out ${item.outflow}; running ${item.runningCash}`
  }));
  const inflowRows = report.inflows.map(item => ({ rowType: "Inflow", reference: item.id, project: item.project, map: item.map, date: item.expectedDate, status: item.status, amount: item.amount, detail: item.detail }));
  const outflowRows = report.outflows.map(item => ({ rowType: "Outflow", reference: item.id, project: item.project, map: item.map, date: item.expectedDate, status: item.status, amount: item.amount, detail: item.detail }));
  const reconciliationRows = report.reconciliation.map(item => ({ rowType: "Receipt reconciliation", reference: item.id, project: item.project, map: item.map, date: item.actualDate, status: item.depositStatus || item.status, amount: item.actualAmount, detail: `Expected ${item.expectedAmount}; variance ${item.variance}; ${item.reference}; proof ${item.bankProof || "missing"}` }));
  const taskRows = report.cashDecisionTasks.map(item => ({ rowType: "Cash task", reference: item.id, project: item.project, map: item.project || "", date: item.dueDate, status: item.status, amount: item.projectedEndingCash || "", detail: `${item.owner || ""}; ${item.notes || ""}` }));
  const historyRows = report.decisionHistory.map(item => ({ rowType: "Decision history", reference: item.task || item.action, project: item.project, map: item.project || "", date: item.at, status: item.reviewStatus, amount: item.endingCash, detail: `${item.by || ""}; ${item.notes || ""}` }));
  return [...bucketRows, ...inflowRows, ...outflowRows, ...reconciliationRows, ...taskRows, ...historyRows];
}

function depositBatchCsvRows(report) {
  return report.batches.flatMap(batch => {
    const header = {
      rowType: "Batch",
      batch: batch.id,
      receipt: "",
      project: "",
      invoice: "",
      depositDate: batch.depositDate,
      status: batch.status,
      amount: batch.receiptTotal,
      bankFeedAmount: batch.bankFeedAmount,
      variance: batch.variance,
      detail: `${batch.receiptCount} receipt(s); proof ${batch.proofCount}/${batch.receiptCount}; verified ${batch.verifiedReceiptCount}/${batch.receiptCount}`
    };
    const receipts = (report.receipts || [])
      .filter(receipt => batch.receipts.includes(receipt.id))
      .map(receipt => ({
        rowType: "Receipt",
        batch: batch.id,
        receipt: receipt.id,
        project: receipt.project,
        invoice: receipt.invoice,
        depositDate: receipt.actualDate,
        status: receipt.depositStatus || receipt.status,
        amount: receipt.actualAmount,
        bankFeedAmount: "",
        variance: receipt.variance,
        detail: `${receipt.reference || ""}; proof ${receipt.bankProof || "missing"}`
      }));
    return [header, ...receipts];
  });
}

function projectLabel(db, projectId) {
  const project = (db.projects || []).find(item => item.id === projectId);
  return project ? `${project.map || project.id} - ${project.scope}` : projectId || "";
}

function packetLockReportTimeline(lock) {
  const events = [];
  if (lock.createdAt) events.push({ project: lock.project, scope: lock.scope, lock: lock.id, status: "Created", at: lock.createdAt, by: lock.finalizedBy, detail: "Packet lock record created." });
  (lock.activityLog || []).forEach(item => {
    events.push({
      project: lock.project,
      scope: lock.scope,
      lock: lock.id,
      status: String(item.note || "").toLowerCase().includes("reopened") ? "Reopened" : String(item.note || "").toLowerCase().includes("finalized") ? "Finalized" : "Updated",
      at: item.at,
      by: item.by,
      detail: item.note
    });
  });
  if (lock.reopenedAt) events.push({ project: lock.project, scope: lock.scope, lock: lock.id, status: "Reopened", at: lock.reopenedAt, by: lock.reopenedBy, detail: lock.reopenReason || "No reopen reason recorded." });
  if (lock.finalizedAt) events.push({ project: lock.project, scope: lock.scope, lock: lock.id, status: "Finalized", at: lock.finalizedAt, by: lock.finalizedBy, detail: `${lock.checklistSnapshot?.filter(item => item.ok).length || 0}/${lock.checklistSnapshot?.length || 0} checklist items ready.` });
  return events;
}

function packetLockCsvRows(report) {
  const timelineRows = report.timeline.map(item => {
    const project = report.projects.find(row => row.id === item.project) || {};
    return {
      rowType: "Packet timeline",
      project: item.project,
      map: project.map || item.project,
      customer: project.customer || "",
      scope: item.scope,
      lock: item.lock,
      task: "",
      status: item.status,
      kind: "",
      at: item.at || "",
      by: item.by || "",
      detail: item.detail || ""
    };
  });
  const controlRows = (report.alertControls || []).map(item => {
    const project = report.projects.find(row => row.id === item.project) || {};
    return {
      rowType: "Alert control",
      project: item.project || "",
      map: project.map || item.project || "",
      customer: project.customer || "",
      scope: "",
      lock: item.alertId || "",
      task: "",
      status: item.status || "",
      kind: item.kind || "",
      at: item.modifiedAt || item.createdAt || "",
      by: item.updatedBy || "",
      detail: item.notes || ""
    };
  });
  const mismatchRows = (report.scopeMismatchEvents || []).map(item => {
    const detail = item.detail || {};
    const project = report.projects.find(row => row.id === detail.project) || {};
    return {
      rowType: "Scope mismatch",
      project: detail.project || "",
      map: project.map || detail.project || "",
      customer: project.customer || "",
      scope: detail.finalizedScope || "",
      lock: "",
      task: detail.task || "",
      status: "Needs Review",
      kind: "Scope mismatch",
      at: item.at || "",
      by: detail.by || "",
      detail: `Expected scope(s): ${(detail.expectedScopes || []).join(", ")}`
    };
  });
  const taskRows = (report.packetTasks || []).map(item => {
    const project = report.projects.find(row => row.id === item.project) || {};
    return {
      rowType: "Packet task",
      project: item.project || "",
      map: project.map || item.project || "",
      customer: project.customer || "",
      scope: (item.reopenScopes || []).join(", "),
      lock: (item.relatedLockIds || []).join(", "),
      task: item.id || "",
      status: item.status || "",
      kind: item.source || "",
      at: item.modifiedAt || item.createdAt || "",
      by: item.owner || "",
      detail: item.notes || ""
    };
  });
  const evidenceRows = (report.evidenceReviews || []).map(item => ({
    rowType: "Evidence review",
    project: item.project || "",
    map: item.map || item.project || "",
    customer: item.customer || "",
    scope: "",
    lock: "",
    task: "",
    status: item.status || "",
    kind: item.label || item.key || "Evidence review",
    at: item.at || "",
    by: item.by || "",
    detail: `${item.note || `Source status: ${item.sourceStatus || ""}`}${item.attachments?.length ? `; attachments: ${item.attachments.map(ref => ref.label || ref.id).join(", ")}` : ""}`
  }));
  return [...timelineRows, ...controlRows, ...mismatchRows, ...taskRows, ...evidenceRows];
}

function closeoutReadinessBreachCsvRows(report) {
  const rowFor = row => ({
    rowType: "Closeout readiness SLA breach",
    generatedAt: report.generatedAt,
    project: row?.project || report.project || "",
    map: row?.map || "",
    customer: row?.customer || "",
    taskId: row?.taskId || "",
    taskTitle: row?.taskTitle || "",
    blockerKey: row?.blockerKey || "",
    blockerLabel: row?.blockerLabel || "",
    blockerDetail: row?.blockerDetail || "",
    currentOwner: row?.currentOwner || "",
    recommendedOwner: row?.recommendedOwner || "",
    recommendedRole: row?.recommendedRole || "",
    dueDate: row?.dueDate || "",
    taskAge: row?.taskAge ?? "",
    handoffAge: row?.handoffAge ?? "",
    status: row?.status || "No breaches",
    severity: row?.severity || "",
    detail: row?.detail || "No closeout readiness task has breached the configured SLA.",
    ownerMismatch: row?.ownerMismatch ? "Yes" : "No",
    overdue: row?.overdue ? "Yes" : "No",
    staleHandoff: row?.staleHandoff ? "Yes" : "No",
    staleTask: row?.staleTask ? "Yes" : "No",
    needsEscalation: row?.needsEscalation ? "Yes" : "No",
    policyWarningDays: report.policy.warningDays,
    policyEscalationDays: report.policy.escalationDays,
    policyHandoffAgingDays: report.policy.handoffAgingDays,
    policyOwnerMismatchEscalates: report.policy.ownerMismatchEscalates,
    handoffHistory: row?.handoffHistory || ""
  });
  return report.breaches.length ? report.breaches.map(rowFor) : [rowFor(null)];
}

function recomputeProject(db, projectId) {
  const project = db.projects.find(item => item.id === projectId);
  if (!project) return null;
  if (project.baseActualCost === undefined) project.baseActualCost = Number(project.actualCost || 0);

  db.projectUnits
    .filter(unit => unit.project === projectId)
    .forEach(unit => {
      unit.completedQuantity = sum(
        db.dailyProduction.filter(line => line.project === projectId && line.unitCode === unit.unitCode),
        "quantity"
      );
      unit.billableQuantity = Math.max(0, Number(unit.completedQuantity || 0) - Number(unit.previouslyBilledQuantity || 0));
    });

  const laborCost = db.dailyLabor
    .filter(line => line.project === projectId)
    .reduce((total, line) => total + Number(line.hours || 0) * Number(line.costRate || 0), 0);
  const equipmentCost = db.dailyEquipment
    .filter(line => line.project === projectId)
    .reduce((total, line) => total + Number(line.hours || 0) * Number(line.rate || 0), 0);
  const materialCost = db.dailyMaterials
    .filter(line => line.project === projectId && line.owner !== "SQUAN")
    .reduce((total, line) => total + Number(line.quantity || 0) * Number(line.unitCost || 0), 0);

  project.actualCost = Math.round(Number(project.baseActualCost || 0) + laborCost + equipmentCost + materialCost);
  project.forecastCost = Math.max(Number(project.forecastCost || 0), project.actualCost);
  recomputeBillingReadiness(db, projectId);
  return project;
}

function recomputeBillingReadiness(db, projectId) {
  const project = db.projects.find(item => item.id === projectId);
  if (!project) return null;
  const rule = (db.contractRules || []).find(item => item.customer === project.customer) || {};
  const submittedDailies = db.dailies.filter(daily => daily.project === projectId && daily.status === "Submitted");
  const projectUnits = db.projectUnits.filter(unit => unit.project === projectId);
  const documents = (db.documents || []).filter(item => item.project === projectId);
  const photos = (db.photoEvidence || []).filter(item => item.project === projectId);
  const qcCloseouts = (db.qcCloseouts || []).filter(item => item.project === projectId);
  const openObstacles = (db.obstacles || []).filter(item => item.project === projectId && !["Resolved", "Field Verified"].includes(item.status));
  const billableAmount = projectUnits.reduce((total, unit) => {
    return total + Number(unit.billableQuantity || 0) * Number(unit.unitPrice || 0);
  }, 0);
  const docs = `${project.docs || ""} ${documents.map(item => `${item.type} ${item.name} ${item.status}`).join(" ")}`.toLowerCase();
  const requiredDocs = String(rule.requiredInvoiceDocs || "dailies, SOT, photos, as-builts")
    .split(",")
    .map(item => item.trim().toLowerCase())
    .filter(Boolean);
  const checks = {
    daily: !requiredDocs.includes("dailies") || submittedDailies.length > 0,
    sot: !requiredDocs.includes("sot") || submittedDailies.some(daily => String(daily.output || "").toLowerCase().includes("sot")),
    photos: !requiredDocs.includes("photos") || photos.length > 0 || docs.includes("photos") || submittedDailies.some(daily => String(daily.output || "").toLowerCase().includes("photos")),
    asBuilts: !requiredDocs.includes("as-builts") || docs.includes("as-built") || docs.includes("asbuilt"),
    qc: !requiredDocs.includes("qc closeout") || qcCloseouts.some(item => item.status === "Passed" || item.status === "Approved Exception"),
    obstacles: openObstacles.length === 0
  };
  const missingItems = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([key]) => ({
      daily: "submitted daily",
      sot: "SOT",
      photos: "photos",
      asBuilts: "as-builts",
      qc: "QC closeout",
      obstacles: "open site obstacles"
    }[key]));
  const daysLeft = daysUntil(project.billBy);
  const status = billableAmount <= 0
    ? "Not Ready"
    : daysLeft < 0
      ? "Overdue / Forfeiture Risk"
      : missingItems.length
      ? "Blocked"
      : daysLeft <= 3
        ? "3 Days Left"
        : daysLeft <= 7
          ? "7 Days Left"
          : "Ready to Bill";
  const next = {
    id: `BR-${projectId}`,
    project: projectId,
    status,
    billableAmount: Math.round(billableAmount),
    missingItems: missingItems.join(", ") || "None",
    billingDeadline: project.billBy,
    daysLeft,
    submittedDailies: submittedDailies.length,
    retainagePercent: Number(rule.retainagePercent || 10),
    payWhenPaid: rule.payWhenPaid === "Yes" ? "Required" : "Not required",
    updatedAt: new Date().toISOString()
  };
  const index = db.billingReadiness.findIndex(item => item.project === projectId);
  if (index === -1) db.billingReadiness.push(next);
  else db.billingReadiness[index] = next;
  return next;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function daysUntil(dateText) {
  if (!dateText || dateText === "N/A") return 9999;
  const today = new Date("2026-05-09T12:00:00");
  const target = new Date(`${dateText}T12:00:00`);
  return Math.ceil((target - today) / 86400000);
}

function ageDays(dateText) {
  if (!dateText || dateText === "N/A") return null;
  const target = new Date(dateText);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date("2026-05-13T12:00:00");
  return Math.max(0, Math.floor((today - target) / 86400000));
}

function todayIso() {
  return "2026-05-09";
}

function addDays(dateText, count) {
  const base = new Date(`${dateText || todayIso()}T12:00:00`);
  if (Number.isNaN(base.getTime())) return "";
  base.setDate(base.getDate() + count);
  return base.toISOString().slice(0, 10);
}

function nextFriday(dateText) {
  const base = new Date(`${dateText || todayIso()}T12:00:00`);
  if (Number.isNaN(base.getTime())) return addDays(todayIso(), 6);
  const day = base.getDay();
  const daysToFriday = (5 - day + 7) % 7 || 7;
  base.setDate(base.getDate() + daysToFriday);
  return base.toISOString().slice(0, 10);
}

function roleLaborRate(role = "") {
  const normal = String(role).toLowerCase();
  if (normal.includes("foreman")) return 42;
  if (normal.includes("operator")) return 38;
  if (normal.includes("traffic")) return 34;
  if (normal.includes("lineman")) return 39;
  return 34;
}

function appendAudit(db, action, detail) {
  const now = new Date().toISOString();
  const id = `AUD-${String(db.auditLog.length + 1).padStart(4, "0")}`;
  db.auditLog.push({
    id,
    at: now,
    action,
    detail,
    notes: `auditLog record ${id}`,
    activityLog: [],
    createdAt: now,
    modifiedAt: now
  });
}

function csv(rows, explicitHeaders = []) {
  if (!rows.length && !explicitHeaders.length) return "";
  const headers = explicitHeaders.length ? explicitHeaders : Object.keys(rows[0]);
  const escape = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    headers.map(escape).join(","),
    ...rows.map(row => headers.map(header => escape(row[header])).join(","))
  ].join("\n");
}

const approvedProductionCsvHeaders = [
  "dataMode",
  "sourceSummary",
  "dailyId",
  "mapNtp",
  "project",
  "workedDate",
  "foreman",
  "code",
  "description",
  "quantity",
  "uom",
  "unitRate",
  "rateSource",
  "rateVersion",
  "calculatedAmount",
  "amountVariance",
  "submittedAmount",
  "squanBillableAmount",
  "contractorPayableAmount",
  "inHouseCostAmount",
  "reviewStatus",
  "proofStatus",
  "billingStatus",
  "payableStatus",
  "notes"
];

const billingPackageCsvHeaders = [
  "dataMode",
  "sourceSummary",
  "packageKey",
  "packageStatus",
  "mapNtp",
  "workedDate",
  "code",
  "dailyId",
  "foreman",
  "quantity",
  "uom",
  "unitRate",
  "rateSource",
  "rateVersion",
  "calculatedSquanAmount",
  "squanVariance",
  "squanBillableAmount",
  "contractorRate",
  "calculatedContractorAmount",
  "contractorVariance",
  "contractorPayableAmount",
  "inHouseCostAmount",
  "proofStatus",
  "reviewStatus",
  "billingStatus",
  "invoice",
  "submission",
  "blockers"
];

const squanTrackerRecordCsvHeaders = [
  "dataMode",
  "sourceSummary",
  "mapNtp",
  "dailyId",
  "productionLineId",
  "billingLedgerId",
  "workedDate",
  "foreman",
  "nodeClli",
  "streetFeeder",
  "billingCode",
  "description",
  "quantity",
  "uom",
  "rate",
  "extendedAmount",
  "proofStatus",
  "adminReviewStatus",
  "packageId",
  "packageVersion",
  "correctionOf",
  "manualTrackerReference",
  "recordkeepingNote"
];

const billingPackagePaymentCsvHeaders = [
  "dataMode",
  "sourceSummary",
  "packageKey",
  "mapNtp",
  "workedDate",
  "code",
  "packageStatus",
  "invoice",
  "submission",
  "squanSubmittedValue",
  "squanPaidAmount",
  "squanHoldbackAmount",
  "squanPaymentVariance",
  "contractorPayableAmount",
  "contractorPaidAmount",
  "contractorOpenAmount",
  "paymentStatus",
  "contractorPaymentStatus",
  "paymentReferences",
  "lastPaymentDate"
];

const contractorSettlementCsvHeaders = [
  "dataMode",
  "sourceSummary",
  "settlementId",
  "packageKey",
  "mapNtp",
  "workedDate",
  "contractor",
  "billingCode",
  "lineCount",
  "agreementId",
  "contractorShare",
  "jacksonShare",
  "grossAmount",
  "deductionTotal",
  "netDue",
  "paidAmount",
  "balance",
  "status",
  "paymentStatus"
];

const contractorDeductionCsvHeaders = [
  "dataMode",
  "sourceSummary",
  "deductionId",
  "settlementId",
  "packageKey",
  "mapNtp",
  "contractor",
  "category",
  "amount",
  "deductionDate",
  "status",
  "reason",
  "enteredBy"
];

const contractorSettlementPaymentCsvHeaders = [
  "dataMode",
  "sourceSummary",
  "paymentId",
  "settlementId",
  "packageKey",
  "mapNtp",
  "contractor",
  "amount",
  "paymentDate",
  "reference",
  "status",
  "paidBy",
  "note"
];

const contractorAgreementCsvHeaders = [
  "dataMode",
  "sourceSummary",
  "agreementId",
  "contractor",
  "status",
  "effectiveDate",
  "contractorShare",
  "jacksonShare",
  "basis",
  "rateVisibility",
  "priorAgreementId",
  "notes"
];

const billingPackageLifecycleCsvHeaders = [
  "dataMode",
  "sourceSummary",
  "packageKey",
  "mapNtp",
  "workedDate",
  "code",
  "foreman",
  "quantity",
  "squanSubmittedValue",
  "rateAuditStatus",
  "packageStatus",
  "submissionStatus",
  "approvedAmount",
  "responseVariance",
  "squanPaidAmount",
  "squanVariance",
  "squanHoldbackAmount",
  "contractorPayableAmount",
  "contractorPaidAmount",
  "nextAction"
];

const billingPackageExceptionCsvHeaders = [
  "dataMode",
  "sourceSummary",
  "packageKey",
  "mapNtp",
  "workedDate",
  "code",
  "exceptionType",
  "detail",
  "owner",
  "amount",
  "nextAction"
];

const priceSheetCatalogCsvHeaders = [
  "dataMode",
  "sourceSummary",
  "code",
  "unitName",
  "description",
  "uom",
  "subRate",
  "aspect",
  "sourceType",
  "sourceFile",
  "status",
  "readiness",
  "usedLineCount",
  "submittedQuantity",
  "approvedQuantity",
  "billableQuantity",
  "submittedAmount",
  "billableAmount",
  "owners",
  "projects"
];

const operationalCleanupCsvHeaders = [
  "type",
  "owner",
  "severity",
  "status",
  "project",
  "sourceId",
  "detail",
  "action",
  "focus"
];

const operationalReadinessCsvHeaders = [
  "area",
  "owner",
  "status",
  "detail",
  "blockers"
];

const operationalCloseoutCsvHeaders = [
  "item",
  "owner",
  "status",
  "detail"
];

const importedSubmissionCsvHeaders = [
  "dataMode",
  "sourceSummary",
  "sourceId",
  "project",
  "workedDate",
  "tech",
  "node",
  "feeder",
  "code",
  "description",
  "quantity",
  "uom",
  "squanAmount",
  "status",
  "dataClassification",
  "sourceLock",
  "resubmissionStatus",
  "linkedJacksonDailyId"
];

const resubmissionComparisonCsvHeaders = [
  "sourceId",
  "jacksonDailyId",
  "sourceProject",
  "jacksonProject",
  "projectMatch",
  "sourceWorkedDate",
  "jacksonWorkedDate",
  "dateMatch",
  "code",
  "codeStatus",
  "sourceQuantity",
  "jacksonQuantity",
  "quantityMatch",
  "proofStatus",
  "billingReadiness",
  "blockers"
];

const demoArchiveCsvHeaders = [
  "collection",
  "id",
  "project",
  "classification",
  "status",
  "owner",
  "detail"
];

function rateSourceForCodeServer(db, code) {
  const price = (db.priceSheetItems || []).find(item => item.code === code);
  if (price) return { ...price, source: "priceSheetItems", sourceId: price.id || price.code || code };
  const unit = (db.unitPrices || []).find(item => item.id === code || item.unitCode === code);
  if (unit) return { ...unit, source: "unitPrices", sourceId: unit.id || unit.unitCode || code };
  return null;
}

function priceSheetReadinessServer(item = {}) {
  if (!item.code) return "Missing Code";
  if (item.code === "HRS") return "Prior Approval";
  if (Number(item.subRate ?? item.unitPrice ?? item.price ?? 0) <= 0) return "Rate Review";
  return "Ready";
}

function dataSourceModeServer(record = {}) {
  const classification = dataSourceClassificationServer(record);
  if (classification === "Real Imported") return "Imported";
  if (classification === "Live Jackson Submission") return "Live";
  if (classification === "Manual Adjustment") return "Manual";
  if (classification === "Archived Demo" || classification === "Demo") return "Demo";
  if (classification === "Generated") return "Generated";
  if (classification === "Live") return "Live";
  const text = [
    record.dataMode,
    record.sourceClass,
    record.sourceType,
    record.source,
    record.sourceFile,
    record.notes,
    record.description,
    record.id
  ].filter(Boolean).join(" ").toLowerCase();
  if (/demo|seeded|sample|placeholder/.test(text)) return "Demo";
  if (/manual|override|agreement|settlement|payment|deduction/.test(text)) return "Manual";
  if (/import|csv|prime sheet|squan|brightspeed|rdb/.test(text)) return "Imported";
  if (/generated|system|auto/.test(text)) return "Generated";
  return "Live";
}

function dataSourceClassificationServer(record = {}) {
  const explicit = record.dataClassification || record.sourceClassification || "";
  if (/archived demo|demo archive|training archive/i.test(explicit)) return "Archived Demo";
  if (/real imported|imported source|source import/i.test(explicit)) return "Real Imported";
  if (/live jackson|jackson submission|resubmission/i.test(explicit)) return "Live Jackson Submission";
  if (/manual adjustment|manual/i.test(explicit)) return "Manual Adjustment";
  if (/demo|training|sample|placeholder/i.test(explicit)) return "Demo";
  if (/generated|system/i.test(explicit)) return "Generated";
  if (/live/i.test(explicit)) return "Live";
  const text = [
    record.dataMode,
    record.sourceClass,
    record.sourceType,
    record.source,
    record.sourceFile,
    record.notes,
    record.description,
    record.importId,
    record.id
  ].filter(Boolean).join(" ").toLowerCase();
  if (/archived demo|demo archive|training archive/.test(text)) return "Archived Demo";
  if (/demo|seeded|sample|placeholder|training/.test(text)) return "Demo";
  if (/manual|override|agreement|settlement|payment|deduction/.test(text)) return "Manual Adjustment";
  if (/import|csv|prime sheet|squan|brightspeed|rdb/.test(text)) return "Real Imported";
  if (/generated|system|auto/.test(text)) return "Generated";
  return "Live";
}

function isArchivedDemoRecordServer(record = {}) {
  return dataSourceClassificationServer(record) === "Archived Demo";
}

function isDemoRecordServer(record = {}) {
  return ["Demo", "Archived Demo"].includes(dataSourceClassificationServer(record));
}

function dataModeSummaryServer(records = []) {
  const counts = { Live: 0, Imported: 0, Demo: 0, Generated: 0, Manual: 0 };
  records.forEach(record => {
    const mode = dataSourceModeServer(record);
    counts[mode] = (counts[mode] || 0) + 1;
  });
  const active = Object.entries(counts).filter(([, value]) => value > 0);
  return {
    dataMode: active.length === 0 ? "Not Ready" : active.length === 1 ? active[0][0] : "Mixed",
    sourceSummary: active.map(([key, value]) => `${key}:${value}`).join("; ") || "No source records"
  };
}

function operationalCleanupRowsServer(db) {
  const productionLines = (db.productionLines || []).filter(line => !isArchivedDemoRecordServer(line));
  const billingLedger = (db.billingLedger || []).filter(row => !isArchivedDemoRecordServer(row));
  const priceRows = db.priceSheetItems || [];
  const packages = billingPackageWorkflowRowsServer(db);
  const settlements = contractorSettlementRowsServer(db);
  const priceByCode = new Map(priceRows.map(item => [item.code, item]));
  const usedCodes = [...new Set(productionLines.map(line => line.code).filter(Boolean))];
  const missingRates = usedCodes.filter(code => !priceByCode.has(code));
  const zeroRates = priceRows.filter(item => Number(item.subRate ?? item.unitPrice ?? item.price ?? 0) <= 0 && item.code !== "HRS");
  const missingUom = [...productionLines.filter(line => !line.uom), ...priceRows.filter(item => !item.uom)];
  const missingProof = productionLines.filter(line => !["Accepted", "Accepted Exception"].includes(proofStateForProductionLine(db, line)));
  const unapproved = productionLines.filter(line => !["Approved", "Accepted"].includes(line.reviewStatus || line.status));
  const unmatchedLedger = billingLedger.filter(row => !productionLines.some(line => line.id === row.productionLineId));
  const settlementBlockers = settlements.flatMap(row => {
    const blockers = [
      !row.agreementId ? "Missing contractor agreement" : "",
      Number(row.grossAmount || 0) <= 0 ? "Gross contractor share is zero" : "",
      Number(row.deductionTotal || 0) > Number(row.grossAmount || 0) ? "Deductions exceed gross settlement" : "",
      row.status === "Disputed" ? "Disputed settlement is open" : ""
    ].filter(Boolean);
    return blockers.map(detail => ({ row, detail }));
  });
  return [
    ...[
      ...(db.productionDailies || []),
      ...(db.productionLines || []),
      ...(db.billingLedger || []),
      ...(db.squanProductionLines || [])
    ].filter(item => isDemoRecordServer(item) && !isArchivedDemoRecordServer(item)).map(line => ({ type: "Demo / training record", owner: "Admin", severity: "Medium", status: "Open", project: line.project || line.ntp || "", sourceId: line.id, detail: `${line.id} should move to the demo archive before go-live counts are reviewed.`, action: "Production", focus: "Demo Archive" })),
    ...missingRates.map(code => ({ type: "Missing rate", owner: "Billing", severity: "Critical", status: "Open", project: "", sourceId: code, detail: `${code} is used but not in the imported price sheet.`, action: "Production", focus: "Billing code catalog" })),
    ...zeroRates.map(item => ({ type: "Zero rate", owner: "Billing", severity: "Critical", status: "Open", project: "", sourceId: item.code || item.id, detail: `${item.code} has zero/missing rate.`, action: "Production", focus: "Billing code catalog" })),
    ...missingUom.map(item => ({ type: "Missing UOM", owner: "Billing", severity: "Medium", status: "Open", project: item.project || "", sourceId: item.code || item.id, detail: `${item.code || item.id} is missing UOM.`, action: "Production", focus: "Billing code catalog" })),
    ...missingProof.map(line => ({ type: "Missing proof", owner: "Foreman", severity: "High", status: "Open", project: line.project || "", sourceId: line.id, detail: `${line.id} ${line.code} proof is ${proofStateForProductionLine(db, line)}.`, action: "Production", focus: "Submit Daily" })),
    ...unapproved.map(line => ({ type: "Unapproved production", owner: "Operations", severity: "High", status: "Open", project: line.project || "", sourceId: line.id, detail: `${line.id} review is ${line.reviewStatus || line.status || "Missing"}.`, action: "Production", focus: "Review" })),
    ...unmatchedLedger.map(row => ({ type: "Unmatched ledger", owner: "Billing", severity: "High", status: "Open", project: row.project || "", sourceId: row.id, detail: `${row.id} has no matching production line.`, action: "Billing", focus: "Billing ownership and blockers" })),
    ...settlementBlockers.map(({ row, detail }) => ({ type: "Settlement blocker", owner: "Billing", severity: "High", status: "Open", project: row.mapNtp || "", sourceId: row.settlementId, detail: `${row.contractor}: ${detail}`, action: "Billing", focus: "Contractor settlement" })),
    ...packages.filter(pack => pack.blockers?.length).map(pack => ({ type: "Package blocker", owner: "Billing", severity: "High", status: "Open", project: pack.projectId, sourceId: pack.key, detail: pack.blockers.join("; "), action: "Billing", focus: "Ready to submit" }))
  ];
}

function operationalReadinessCsvRowsServer(db) {
  const cleanup = operationalCleanupRowsServer(db);
  const source = dataModeSummaryServer([
    ...(db.productionDailies || []),
    ...(db.productionLines || []),
    ...(db.billingLedger || []),
    ...(db.priceSheetItems || []),
    ...(db.squanImports || []),
    ...(db.contractorAgreements || []),
    ...(db.contractorSettlements || [])
  ]);
  const count = type => cleanup.filter(item => item.type === type).length;
  const ready = cleanup.length === 0;
  const deployment = db.company?.deploymentReadiness || {};
  const deploymentReady = Boolean(
    deployment.hostingTarget &&
    deployment.persistenceMode &&
    deployment.backupOwner &&
    deployment.restoreDrillStatus &&
    deployment.mysqlDatabase
  );
  return [
    { area: "Foreman Daily Capture", owner: "Foreman", status: "Ready for Review", detail: "Daily Capture form, code/quantity entry, proof note, draft, submit, and correction loop are wired.", blockers: count("Missing proof") },
    { area: "Admin/Ops Review", owner: "Operations", status: count("Unapproved production") ? "Needs Cleanup" : "Ready for Review", detail: "Production approval and proof review drive billing readiness.", blockers: count("Unapproved production") },
    { area: "Billing Package", owner: "Billing", status: count("Package blocker") ? "Needs Cleanup" : "Ready for Review", detail: "Billing packages group ready production by Map, date, and code.", blockers: count("Package blocker") },
    { area: "SQUAN Submission", owner: "Billing", status: "Ready for Review", detail: "CSV supports recordkeeping and manual entry into the outside SQUAN Tracker.", blockers: 0 },
    { area: "SQUAN Payment / Holdback", owner: "Billing", status: "Ready for Review", detail: "Payment, holdback, variance, and follow-up records are separate from contractor settlement.", blockers: 0 },
    { area: "Contractor Settlements", owner: "Billing", status: count("Settlement blocker") ? "Needs Cleanup" : "Ready for Review", detail: "Agreement, gross, deductions, net due, disputes, and payments are tracked.", blockers: count("Settlement blocker") },
    { area: "Reports / Exports", owner: "Billing", status: "Ready for Review", detail: "Production, package, lifecycle, exceptions, payment, settlement, and price sheet CSVs are available.", blockers: 0 },
    { area: "Permissions / Visibility", owner: "Admin", status: "Ready for Review", detail: "Role nav and action guards control restricted workflows.", blockers: 0 },
    { area: "Real Data Readiness", owner: "Admin", status: ready ? "Operational Ready" : "Needs Cleanup", detail: source.sourceSummary, blockers: cleanup.length },
    { area: "Operational Cleanup Queue", owner: "Admin", status: "Ready for Review", detail: "Cleanup blockers export with owner, source, route, and status.", blockers: cleanup.length },
    { area: "Button / Workflow QA", owner: "Admin", status: "Ready for Review", detail: "Workflow confidence and browser QA are wired through npm run check.", blockers: 0 },
    {
      area: "Deployment / Backup",
      owner: "Admin",
      status: deploymentReady ? deployment.status || "Ready for Review" : "Needs Decision",
      detail: deploymentReady
        ? `${deployment.persistenceMode}; backup owner ${deployment.backupOwner}; restore drill ${deployment.restoreDrillStatus}.`
        : "Hosting, database persistence, backup, restore, and admin recovery need final go-live decision.",
      blockers: deploymentReady ? 0 : 1
    }
  ];
}

function operationalCloseoutCsvRowsServer(db) {
  const realImports = (db.squanProductionLines || []).filter(line => dataSourceClassificationServer(line) === "Real Imported").length;
  const deployment = db.company?.deploymentReadiness || {};
  const realUsers = db.company?.realUserReadiness || {};
  const tracker = db.company?.squanTrackerConfirmation || {};
  const persistenceReady = Boolean(deployment.mysqlDatabase && deployment.persistenceMode);
  const userReady = Boolean(realUsers.userCount && realUsers.roleCount);
  const trackerReady = /ready|confirmed/i.test(tracker.status || "");
  return [
    { item: "Real workflow validation", owner: "Admin/Ops", status: realImports ? "Ready for Review" : "Needs Data", detail: "Walk real imports through linked Jackson resubmission, approval, billing, SQUAN response, and settlement." },
    { item: "Persistence/database prep", owner: "Admin", status: persistenceReady ? deployment.status || "Ready for Pilot" : "Needs Decision", detail: persistenceReady ? deployment.persistenceMode : "Node remains runtime; MAMP MySQL is the next durable persistence target after schema approval." },
    { item: "Role permission QA", owner: "Admin", status: "Ready for Review", detail: "Verify Foreman, Admin, Operations, Billing, and Safety only see permitted screens/actions." },
    { item: "Final UX polish", owner: "Admin", status: "Ready for Review", detail: "Keep role home focused on next actions; move dense tables into reports/tools drawers." },
    { item: "Backup/restore/go-live procedure", owner: "Admin", status: deployment.restoreDrillStatus ? "Ready for Pilot" : "Ready for Review", detail: deployment.restoreDrillStatus || "Use Admin backup/restore controls until MySQL migration; test restore before go-live." },
    { item: "Real users/roles", owner: "Admin", status: userReady ? realUsers.status || "Pilot Seeded" : "Needs Setup", detail: userReady ? realUsers.notes : "Seed actual Jackson users and assign least-privilege roles before live use." },
    { item: "Record locking rules", owner: "Admin", status: "Defined", detail: "Submitted, approved, packaged, submitted-to-SQUAN, paid, and closed records require revision/correction instead of silent edits." },
    { item: "Correction/revision SOP", owner: "Admin/Ops", status: "Defined", detail: "Corrections never overwrite originals; they create linked revisions with reason, owner, and audit history." },
    { item: "Required field matrix", owner: "Admin", status: "Defined", detail: "Foreman, Admin review, Billing package, SQUAN Tracker, payment, and settlement fields are defined in app guidance." },
    { item: "Confirm SQUAN Tracker field format", owner: "Billing", status: trackerReady ? tracker.status || "Pilot CSV Ready" : "Needs Real-World Confirmation", detail: tracker.notes || "Manual Tracker entry uses package CSV for recordkeeping; Billing must confirm exact external fields." },
    { item: "Exception handling", owner: "Operations/Billing", status: "Defined", detail: "Missing proof, wrong code/quantity/map/date, SQUAN rejection/short-pay, and contractor disputes have owner/action paths." },
    { item: "Audit trail review", owner: "Admin", status: "Ready for Review", detail: "Critical submit/review/package/payment/settlement events append audit entries." },
    { item: "Operational dashboard finalization", owner: "Admin", status: "Ready for Review", detail: "Home is role-command first: Foreman submit/correct, Ops review, Billing submit/pay/settle, Admin exceptions/readiness." },
    { item: "Data retention/archive rules", owner: "Admin", status: "Defined", detail: "Closed packages and settlements remain audit records; demo/training rows move to archive and stay out of live readiness." },
    { item: "Deployment runbook", owner: "Admin", status: "Documented", detail: "Run Node app, keep data path known, use backup/restore, define admin recovery, then migrate to MySQL." },
    { item: "Acceptance test script", owner: "Admin", status: "Documented", detail: "Submit daily, approve, package, export, record SQUAN response/payment, settle contractor, verify reports." },
    { item: "Data import SOP", owner: "Billing/Ops", status: "Documented", detail: "Import SQUAN/Brightspeed rows as real read-only originals; archive demo; create linked Jackson resubmissions for billing." }
  ];
}

function importedSubmissionRowsServer(db) {
  const dailies = db.productionDailies || [];
  return (db.squanProductionLines || [])
    .filter(line => dataSourceClassificationServer(line) === "Real Imported")
    .map(source => {
      const linkedDaily = dailies.find(daily => daily.sourceSubmissionId === source.id || daily.resubmissionOf === source.id || daily.linkedSourceSubmissionId === source.id) || {};
      const mode = dataModeSummaryServer([source]);
      return {
        dataMode: mode.dataMode,
        sourceSummary: mode.sourceSummary,
        sourceId: source.id || "",
        project: source.project || source.ntp || source.jobId || "",
        workedDate: source.workedDate || "",
        tech: source.tech || source.submittedBy || "",
        node: source.clli || source.node || "",
        feeder: source.feeder || source.street || "",
        code: source.code || "",
        description: source.description || "",
        quantity: Number(source.quantity || 0),
        uom: source.uom || "",
        squanAmount: Number(source.squanAmount || source.amount || 0),
        status: source.status || "Imported",
        dataClassification: dataSourceClassificationServer(source),
        sourceLock: source.sourceLock || "Original import read-only",
        resubmissionStatus: source.resubmissionStatus || (linkedDaily.id ? "Jackson Daily Created" : "Needs Jackson Review"),
        linkedJacksonDailyId: linkedDaily.id || source.linkedJacksonDailyId || ""
      };
    });
}

function resubmissionAcceptanceChecklistServer(db, source = {}, linkedDaily = {}, linkedLine = {}) {
  const rate = rateSourceForCodeServer(db, source.code || linkedLine.code || "");
  const proof = linkedLine.id ? proofStateForProductionLine(db, linkedLine) : "Missing";
  return [
    { label: "Original imported source preserved", complete: dataSourceClassificationServer(source) === "Real Imported" && source.locked !== false },
    { label: "Jackson daily created", complete: Boolean(linkedDaily.id) },
    { label: "Billing code valid", complete: Boolean(rate && (source.code || linkedLine.code)) },
    { label: "Quantity entered", complete: Number(linkedLine.quantity || source.quantity || 0) > 0 },
    { label: "Proof accepted or exception approved", complete: ["Accepted", "Accepted Exception"].includes(proof) },
    { label: "Admin/Ops reviewed", complete: ["Approved", "Accepted"].includes(linkedLine.reviewStatus || linkedLine.status) },
    { label: "Billing ready", complete: ["Ready to Bill", "Billed", "Closed / Billed"].includes(linkedLine.billableStatus) }
  ];
}

function resubmissionComparisonRowsServer(db) {
  const dailies = db.productionDailies || [];
  const lines = db.productionLines || [];
  return (db.squanProductionLines || [])
    .filter(source => dataSourceClassificationServer(source) === "Real Imported")
    .map(source => {
      const linkedDaily = dailies.find(daily => daily.sourceSubmissionId === source.id || daily.resubmissionOf === source.id || daily.linkedSourceSubmissionId === source.id) || {};
      const linkedLines = lines.filter(line => line.sourceSubmissionId === source.id || line.resubmissionOf === source.id || line.dailyId === linkedDaily.id);
      const linkedLine = linkedLines[linkedLines.length - 1] || {};
      const sourceProject = source.project || source.ntp || source.jobId || "";
      const jacksonProject = linkedLine.project || linkedDaily.project || "";
      const sourceWorkedDate = source.workedDate || "";
      const jacksonWorkedDate = linkedLine.workedDate || linkedDaily.workedDate || "";
      const sourceQuantity = Number(source.quantity || 0);
      const jacksonQuantity = Number(linkedLine.quantity || 0);
      const rate = rateSourceForCodeServer(db, source.code || linkedLine.code || "");
      const checklist = resubmissionAcceptanceChecklistServer(db, source, linkedDaily, linkedLine);
      return {
        sourceId: source.id || "",
        jacksonDailyId: linkedDaily.id || "",
        sourceProject,
        jacksonProject,
        projectMatch: !linkedDaily.id ? "Pending" : sourceProject === jacksonProject ? "Matched" : "Override Needed",
        sourceWorkedDate,
        jacksonWorkedDate,
        dateMatch: !linkedDaily.id ? "Pending" : sourceWorkedDate === jacksonWorkedDate ? "Matched" : "Override Needed",
        code: source.code || linkedLine.code || "",
        codeStatus: rate ? "Valid" : "Missing Rate",
        sourceQuantity,
        jacksonQuantity,
        quantityMatch: !linkedLine.id ? "Pending" : sourceQuantity === jacksonQuantity ? "Matched" : "Variance",
        proofStatus: linkedLine.id ? proofStateForProductionLine(db, linkedLine) : "Missing",
        billingReadiness: checklist.every(item => item.complete) ? "Ready for Package Prep" : "Needs Review",
        blockers: checklist.filter(item => !item.complete).map(item => item.label).join("; ")
      };
    });
}

function demoArchiveRowsServer(db) {
  const collect = (collection, records = []) => records
    .filter(isDemoRecordServer)
    .map(record => ({
      collection,
      id: record.id || "",
      project: record.project || record.ntp || "",
      classification: dataSourceClassificationServer(record),
      status: record.status || record.reviewStatus || "",
      owner: record.submittedBy || record.tech || record.owner || "Admin",
      detail: record.notes || record.description || record.sourceType || ""
    }));
  return [
    ...collect("productionDailies", db.productionDailies || []),
    ...collect("productionLines", db.productionLines || []),
    ...collect("squanProductionLines", db.squanProductionLines || []),
    ...collect("billingLedger", db.billingLedger || [])
  ];
}

function priceSheetCatalogCsvRows(db) {
  const usageByCode = new Map();
  (db.productionLines || []).forEach(line => {
    const code = line.code || "No Code";
    const existing = usageByCode.get(code) || {
      usedLineCount: 0,
      submittedQuantity: 0,
      approvedQuantity: 0,
      billableQuantity: 0,
      submittedAmount: 0,
      billableAmount: 0,
      owners: new Set(),
      projects: new Set()
    };
    existing.usedLineCount += 1;
    existing.submittedQuantity += Number(line.quantity || 0);
    if ((line.reviewStatus || line.status) === "Approved") existing.approvedQuantity += Number(line.quantity || 0);
    if (["Ready to Bill", "Billed", "Closed / Billed"].includes(line.billableStatus)) existing.billableQuantity += Number(line.quantity || 0);
    existing.submittedAmount += Number(line.submittedAmount || 0);
    if (["Ready to Bill", "Billed", "Closed / Billed"].includes(line.billableStatus)) {
      existing.billableAmount += Number(line.squanAmount || line.submittedAmount || 0);
    }
    if (line.submittedBy || line.tech) existing.owners.add(line.submittedBy || line.tech);
    if (line.project || line.ntp) existing.projects.add(line.project || line.ntp);
    usageByCode.set(code, existing);
  });
  const priceCodes = new Set((db.priceSheetItems || []).map(item => item.code).filter(Boolean));
  const missingUsageRows = [...usageByCode.keys()]
    .filter(code => !priceCodes.has(code))
    .map(code => ({
      id: `MISSING-${code}`,
      code,
      unitName: "Missing price sheet row",
      description: "Production line uses this code, but it is not in priceSheetItems.",
      uom: "",
      subRate: 0,
      aspect: "",
      sourceType: "Missing",
      sourceFile: "",
      status: "Rate Review"
    }));
  return [...(db.priceSheetItems || []), ...missingUsageRows]
    .map(item => {
      const usage = usageByCode.get(item.code) || {};
      const mode = dataModeSummaryServer([item]);
      return {
        dataMode: mode.dataMode,
        sourceSummary: mode.sourceSummary,
        code: item.code || "",
        unitName: item.unitName || "",
        description: item.description || "",
        uom: item.uom || item.unit || "",
        subRate: Number(item.subRate ?? item.unitPrice ?? item.price ?? 0),
        aspect: item.aspect || item.category || "",
        sourceType: item.sourceType || item.source || "",
        sourceFile: item.sourceFile || "",
        status: item.status || "",
        readiness: priceSheetReadinessServer(item),
        usedLineCount: Number(usage.usedLineCount || 0),
        submittedQuantity: Number(usage.submittedQuantity || 0),
        approvedQuantity: Number(usage.approvedQuantity || 0),
        billableQuantity: Number(usage.billableQuantity || 0),
        submittedAmount: Number(usage.submittedAmount || 0),
        billableAmount: Number(usage.billableAmount || 0),
        owners: [...(usage.owners || [])].join("; "),
        projects: [...(usage.projects || [])].join("; ")
      };
    })
    .sort((a, b) => Number(b.usedLineCount || 0) - Number(a.usedLineCount || 0) || a.code.localeCompare(b.code));
}

function amountVarianceServer(actual, calculated) {
  return Math.round((Number(actual || 0) - Number(calculated || 0)) * 100) / 100;
}

function rateAuditForPackageLineServer(db, pack, row) {
  const line = row.line || {};
  const ledger = row.ledger || {};
  const code = line.code || ledger.code || pack.code;
  const rate = rateSourceForCodeServer(db, code);
  const quantity = Number(line.quantity || ledger.quantity || 0);
  const squanRate = Number(line.unitRate || rate?.subRate || rate?.price || 0);
  const contractorRate = line.sourceType?.includes("Contractor") ? Number(line.unitRate || rate?.subRate || 0) : 0;
  const calculatedSquanAmount = Math.round(quantity * squanRate * 100) / 100;
  const calculatedContractorAmount = Math.round(quantity * contractorRate * 100) / 100;
  const squanAmount = Number(ledger.squanBillableAmount || line.submittedAmount || 0);
  const contractorAmount = Number(ledger.contractorPayableAmount || 0);
  const squanVariance = amountVarianceServer(squanAmount, calculatedSquanAmount);
  const contractorVariance = amountVarianceServer(contractorAmount, calculatedContractorAmount);
  const issues = [
    !rate ? "Missing rate source" : "",
    squanRate <= 0 ? "Missing SQUAN/customer rate" : "",
    Math.abs(squanVariance) > 0.01 ? "SQUAN amount mismatch" : "",
    line.sourceType?.includes("Contractor") && contractorAmount <= 0 ? "Missing contractor payable" : "",
    line.sourceType?.includes("Contractor") && Math.abs(contractorVariance) > 0.01 ? "Contractor amount mismatch" : ""
  ].filter(Boolean);
  return {
    rateSource: rate?.source || "Unknown",
    rateVersion: rate?.version || rate?.rateVersion || rate?.effectiveDate || "",
    squanRate,
    calculatedSquanAmount,
    squanVariance,
    contractorRate,
    calculatedContractorAmount,
    contractorVariance,
    rateAuditStatus: issues.length ? "Needs Review" : "Matched",
    rateAuditIssues: issues.join("; ")
  };
}

function proofStateForProductionLine(db, line = {}) {
  const evidence = (db.fieldEvidence || []).filter(item => item.productionLineId === line.id || item.dailyId === line.dailyId);
  if (["Accepted", "Accepted Exception"].includes(line.proofStatus)) return line.proofStatus;
  if (evidence.some(item => ["Accepted", "Accepted Exception"].includes(item.status))) return "Accepted";
  if (["Rejected", "Returned", "Needs Correction"].includes(line.proofStatus)) return "Needs Correction";
  if (evidence.length || ["Submitted", "Attached"].includes(line.proofStatus)) return "Needs Review";
  return line.proofStatus || "Missing";
}

function approvedProductionCsvRows(db) {
  const dailies = new Map((db.productionDailies || []).map(daily => [daily.id, daily]));
  const ledger = new Map((db.billingLedger || []).map(row => [row.productionLineId, row]));
  return (db.productionLines || [])
    .filter(line => ["Approved", "Accepted"].includes(line.reviewStatus) || line.billableStatus === "Ready to Bill")
    .map(line => {
      const daily = dailies.get(line.dailyId) || {};
      const bill = ledger.get(line.id) || {};
      const rate = rateSourceForCodeServer(db, line.code || bill.code || "");
      const unitRate = Number(line.unitRate || rate?.subRate || rate?.price || 0);
      const calculatedAmount = Math.round(Number(line.quantity || bill.quantity || 0) * unitRate * 100) / 100;
      const billableAmount = Number(bill.squanBillableAmount || 0);
      const mode = dataModeSummaryServer([line, daily, bill, rate || {}]);
      return {
        dataMode: mode.dataMode,
        sourceSummary: mode.sourceSummary,
        dailyId: daily.externalDailyId || line.dailyId || "",
        mapNtp: line.ntp || line.project || daily.project || "",
        project: line.project || daily.project || "",
        workedDate: line.workedDate || daily.workedDate || "",
        foreman: daily.submittedBy || line.submittedBy || "",
        code: line.code || bill.code || "",
        description: line.unitName || line.mapLayer || "",
        quantity: line.quantity || bill.quantity || 0,
        uom: line.uom || "",
        unitRate: unitRate || "",
        rateSource: rate?.source || "Unknown",
        rateVersion: rate?.version || rate?.rateVersion || rate?.effectiveDate || "",
        calculatedAmount,
        amountVariance: amountVarianceServer(billableAmount || line.submittedAmount || 0, calculatedAmount),
        submittedAmount: line.submittedAmount || "",
        squanBillableAmount: billableAmount,
        contractorPayableAmount: bill.contractorPayableAmount || 0,
        inHouseCostAmount: bill.inHouseCostAmount || 0,
        reviewStatus: line.reviewStatus || "",
        proofStatus: proofStateForProductionLine(db, line),
        billingStatus: bill.billingStatus || line.billableStatus || "",
        payableStatus: line.payableStatus || "",
        notes: line.notes || bill.notes || ""
      };
    });
}

function billingPackageWorkflowRowsServer(db) {
  const lines = db.productionLines || [];
  const dailies = db.productionDailies || [];
  const projects = db.projects || [];
  const submissions = db.invoiceSubmissions || [];
  const invoices = db.invoices || [];
  const snapshots = db.packageSnapshots || [];
  const grouped = new Map();

  (db.billingLedger || [])
    .filter(item => item.billingStatus === "Ready to Bill")
    .forEach(item => {
      const line = lines.find(row => row.id === item.productionLineId) || {};
      const daily = dailies.find(row => row.id === line.dailyId) || {};
      const projectId = item.project || line.project || daily.project || "";
      const workedDate = item.workedDate || line.workedDate || daily.workedDate || "";
      const code = item.code || line.code || "";
      const key = [projectId, workedDate, code].join("|");
      const existing = grouped.get(key) || {
        key,
        projectId,
        project: projects.find(project => project.id === projectId) || { id: projectId, map: projectId },
        workedDate,
        code,
        lines: [],
        lineCount: 0,
        quantity: 0,
        billableAmount: 0,
        payableAmount: 0,
        jobCostAmount: 0,
        proofAccepted: 0,
        owners: new Set(),
        dailyIds: new Set()
      };
      const proofState = proofStateForProductionLine(db, line);
      existing.lines.push({ ledger: item, line, daily, proofState });
      existing.lineCount += 1;
      existing.quantity += Number(line.quantity || item.quantity || 0);
      existing.billableAmount += Number(item.squanBillableAmount || 0);
      existing.payableAmount += Number(item.contractorPayableAmount || 0);
      existing.jobCostAmount += Number(item.inHouseCostAmount || 0);
      if (["Accepted", "Accepted Exception"].includes(proofState)) existing.proofAccepted += 1;
      if (daily.submittedBy || line.submittedBy) existing.owners.add(daily.submittedBy || line.submittedBy);
      if (daily.id || line.dailyId) existing.dailyIds.add(daily.externalDailyId || daily.id || line.dailyId);
      grouped.set(key, existing);
    });

  return [...grouped.values()].map(row => {
    const snapshot = snapshots
      .filter(item => item.scope === "SQUAN Billing Package" && item.packageKey === row.key && item.status !== "Superseded")
      .sort((a, b) => String(b.preparedAt || "").localeCompare(String(a.preparedAt || "")))[0];
    const invoice = snapshot?.invoice
      ? invoices.find(item => item.id === snapshot.invoice)
      : invoices.find(item => item.project === row.projectId && item.packageKey === row.key);
    const submission = submissions.find(item => snapshot?.id && item.packageSnapshot === snapshot.id)
      || submissions.find(item => invoice?.id && item.invoice === invoice.id && item.status !== "Rejected by SQUAN" && item.status !== "Correction Superseded")
      || submissions.find(item => item.packageKey === row.key && item.status !== "Rejected by SQUAN" && item.status !== "Correction Superseded");
    const basePack = {
      ...row,
      owners: [...row.owners],
      dailyIds: [...row.dailyIds],
      invoice,
      submission,
      snapshot
    };
    const rateBlockers = billingPackageRateIssuesServer(db, basePack).map(item => `${item.code}: ${item.issue}`);
    const blockers = [
      row.proofAccepted < row.lineCount ? "Proof not fully accepted" : "",
      !row.billableAmount ? "No billable amount" : "",
      ...rateBlockers,
      submission?.status === "Rejected by SQUAN" ? "Rejected by SQUAN" : ""
    ].filter(Boolean);
    const pack = {
      ...basePack,
      blockers,
      status: submission ? submission.status || "Submitted to SQUAN" : blockers.length ? "Needs Review" : snapshot || invoice ? "Ready to Submit" : "Ready for Package Prep"
    };
    pack.status = billingPackageDerivedStatusServer(db, pack);
    return pack;
  }).sort((a, b) => String(b.workedDate || "").localeCompare(String(a.workedDate || "")) || a.projectId.localeCompare(b.projectId) || a.code.localeCompare(b.code));
}

function billingPackageDerivedStatusServer(db, pack) {
  if (!pack.submission) return pack.status;
  if (pack.submission.status === "Rejected by SQUAN") return "Rejected by SQUAN";
  const money = billingPackageMoneySummaryServer(db, pack);
  const squanClosed = money.submittedValue > 0 && Math.abs(money.squanVariance) <= 0.01;
  const contractorClosed = money.contractorPayable <= 0 || money.contractorOpen <= 0;
  if (squanClosed && contractorClosed) return "Closed";
  if (money.squanPaid > 0 || money.holdback > 0) return "Paid / holdback";
  if (["Approved by SQUAN", "Partially approved by SQUAN"].includes(pack.submission.status)) return pack.submission.status;
  return pack.submission.status || "Submitted to SQUAN";
}

function billingPackageCsvRows(packages = [], db = {}) {
  return packages.flatMap(pack => pack.lines.map(row => {
    const audit = rateAuditForPackageLineServer(db, pack, row);
    const mode = dataModeSummaryServer([pack.snapshot || {}, pack.submission || {}, row.daily, row.line, row.ledger]);
    return {
      dataMode: mode.dataMode,
      sourceSummary: mode.sourceSummary,
      packageKey: pack.key,
      packageStatus: pack.status,
      mapNtp: pack.projectId,
      workedDate: pack.workedDate,
      code: pack.code,
      dailyId: row.daily.externalDailyId || row.daily.id || row.line.dailyId || "",
      foreman: row.daily.submittedBy || row.line.submittedBy || "",
      quantity: row.line.quantity || row.ledger.quantity || 0,
      uom: row.line.uom || "",
      unitRate: row.line.unitRate || "",
      rateSource: audit.rateSource,
      rateVersion: audit.rateVersion,
      calculatedSquanAmount: audit.calculatedSquanAmount,
      squanVariance: audit.squanVariance,
      squanBillableAmount: row.ledger.squanBillableAmount || 0,
      contractorRate: audit.contractorRate,
      calculatedContractorAmount: audit.calculatedContractorAmount,
      contractorVariance: audit.contractorVariance,
      contractorPayableAmount: row.ledger.contractorPayableAmount || 0,
      inHouseCostAmount: row.ledger.inHouseCostAmount || 0,
      proofStatus: row.proofState,
      reviewStatus: row.line.reviewStatus || "",
      billingStatus: row.ledger.billingStatus || row.line.billableStatus || "",
      invoice: pack.invoice?.id || "",
      submission: pack.submission?.confirmationNumber || pack.submission?.status || "",
      blockers: [...pack.blockers, audit.rateAuditIssues].filter(Boolean).join("; ")
    };
  }));
}

function squanTrackerRecordCsvRows(packages = [], db = {}) {
  return packages.flatMap(pack => pack.lines.map(row => {
    const audit = rateAuditForPackageLineServer(db, pack, row);
    const snapshot = pack.snapshot || {};
    const rate = Number(audit.squanRate || row.line.unitRate || 0);
    const quantity = Number(row.line.quantity || row.ledger.quantity || 0);
    const mode = dataModeSummaryServer([snapshot, pack.submission || {}, row.daily, row.line, row.ledger]);
    return {
      dataMode: mode.dataMode,
      sourceSummary: mode.sourceSummary,
      mapNtp: pack.projectId,
      dailyId: row.daily.externalDailyId || row.daily.id || row.line.dailyId || "",
      productionLineId: row.line.id || "",
      billingLedgerId: row.ledger.id || "",
      workedDate: pack.workedDate,
      foreman: row.daily.submittedBy || row.line.submittedBy || "",
      nodeClli: row.line.clli || row.daily.clli || "",
      streetFeeder: row.line.feeder || row.daily.feeder || "",
      billingCode: row.line.code || pack.code,
      description: row.line.unitName || row.line.mapLayer || "",
      quantity,
      uom: row.line.uom || "",
      rate,
      extendedAmount: row.ledger.squanBillableAmount || audit.calculatedSquanAmount || 0,
      proofStatus: row.proofState,
      adminReviewStatus: row.line.reviewStatus || "",
      packageId: snapshot.id || "",
      packageVersion: Number(snapshot.version || 1),
      correctionOf: snapshot.correctionOf || "",
      manualTrackerReference: pack.submission?.confirmationNumber || "",
      recordkeepingNote: "CSV supports Jackson recordkeeping and manual entry into the outside SQUAN Tracker; it is not a direct SQUAN integration."
    };
  }));
}

function readyToSubmitCsvRows(db) {
  return billingPackageCsvRows(billingPackageWorkflowRowsServer(db).filter(pack => pack.status === "Ready to Submit"), db);
}

function billingPackagePaymentCsvRows(db) {
  return billingPackageWorkflowRowsServer(db).map(pack => {
    const receipts = (db.cashReceipts || []).filter(item => item.packageKey === pack.key || (pack.submission?.id && item.submission === pack.submission.id) || (pack.invoice?.id && item.invoice === pack.invoice.id));
    const squanPaid = receipts.filter(item => item.type === "SQUAN Package Payment").reduce((total, item) => total + Number(item.actualAmount || 0), 0);
    const holdback = receipts.filter(item => item.type === "SQUAN Holdback").reduce((total, item) => total + Number(item.actualAmount || 0), 0);
    const contractorPaid = receipts.filter(item => item.type === "Contractor Package Payment").reduce((total, item) => total + Number(item.actualAmount || 0), 0);
    const contractorPayable = Number(pack.payableAmount || 0);
    const submittedValue = Number(pack.submission?.squanSubmittedValue ?? pack.snapshot?.squanSubmittedValue ?? pack.billableAmount ?? 0);
    const mode = dataModeSummaryServer([pack.snapshot || {}, pack.submission || {}, ...pack.lines.flatMap(row => [row.daily, row.line, row.ledger]), ...receipts]);
    return {
      dataMode: mode.dataMode,
      sourceSummary: mode.sourceSummary,
      packageKey: pack.key,
      mapNtp: pack.projectId,
      workedDate: pack.workedDate,
      code: pack.code,
      packageStatus: pack.status,
      invoice: pack.invoice?.id || "",
      submission: pack.submission?.id || "",
      squanSubmittedValue: submittedValue,
      squanPaidAmount: squanPaid,
      squanHoldbackAmount: holdback,
      squanPaymentVariance: submittedValue - squanPaid - holdback,
      contractorPayableAmount: contractorPayable,
      contractorPaidAmount: contractorPaid,
      contractorOpenAmount: contractorPayable - contractorPaid,
      paymentStatus: squanPaid >= submittedValue && submittedValue > 0 ? "Paid" : squanPaid || holdback ? "Partially Paid" : "Open",
      contractorPaymentStatus: contractorPayable <= 0 ? "No contractor payable" : contractorPaid >= contractorPayable ? "Paid" : contractorPaid > 0 ? "Partially Paid" : "Unpaid",
      paymentReferences: receipts.map(item => item.reference).filter(Boolean).join("; "),
      lastPaymentDate: receipts.map(item => item.actualDate).filter(Boolean).sort().at(-1) || ""
    };
  });
}

function defaultContractorAgreementServer(contractor = "Default Contractor") {
  return {
    id: `AGREE-${String(contractor || "DEFAULT").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toUpperCase()}-20260101`,
    contractor,
    status: "Active",
    effectiveDate: "2026-01-01",
    contractorShare: 80,
    jacksonShare: 20,
    basis: "Percent of approved SQUAN production",
    rateVisibility: "Hidden until settlement issued unless Admin/Billing"
  };
}

function agreementForContractorServer(db, contractor = "Default Contractor", workedDate = "") {
  const agreements = (db.contractorAgreements || [])
    .filter(item => (item.contractor === contractor || item.contractor === "Default Contractor") && item.status !== "Inactive")
    .filter(item => !item.effectiveDate || item.effectiveDate <= workedDate)
    .sort((a, b) => String(b.effectiveDate || "").localeCompare(String(a.effectiveDate || "")));
  return agreements[0] || defaultContractorAgreementServer(contractor);
}

function contractorSettlementIdServer(packageKey = "", contractor = "Contractor") {
  return `SETTLE-${String(packageKey || "PACKAGE").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toUpperCase()}-${String(contractor || "CONTRACTOR").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toUpperCase()}`;
}

function contractorSettlementRowsServer(db) {
  const persisted = db.contractorSettlements || [];
  return billingPackageWorkflowRowsServer(db).filter(pack => Number(pack.billableAmount || 0) > 0).flatMap(pack => {
    const owners = pack.owners?.length ? pack.owners : [...new Set(pack.lines.map(row => row.daily.submittedBy || row.line.submittedBy || "Contractor"))];
    return owners.map(owner => {
      const ownerLines = pack.lines.filter(row => (row.daily.submittedBy || row.line.submittedBy || owner) === owner);
      const lines = ownerLines.length ? ownerLines : pack.lines;
      const billable = lines.reduce((total, row) => total + Number(row.ledger.squanBillableAmount || row.line.submittedAmount || 0), 0);
      const existing = persisted.find(item => item.packageKey === pack.key && item.contractor === owner) || {};
      const agreement = existing.agreementSnapshot || agreementForContractorServer(db, owner, pack.workedDate);
      const share = Number(agreement.contractorShare || 0);
      const grossAmount = Number(existing.grossAmount ?? Math.round(billable * share) / 100);
      const settlementId = existing.id || contractorSettlementIdServer(pack.key, owner);
      const deductions = (db.contractorSettlementDeductions || []).filter(item => item.settlementId === settlementId);
      const deductionTotal = deductions.filter(item => item.status !== "Disputed" && item.status !== "Void").reduce((total, item) => total + Number(item.amount || 0), 0);
      const payments = (db.contractorSettlementPayments || []).filter(item => item.settlementId === settlementId);
      const paidAmount = payments.reduce((total, item) => total + Number(item.amount || item.actualAmount || 0), 0);
      const netDue = Math.max(0, Math.round((grossAmount - deductionTotal) * 100) / 100);
      const balance = Math.round((netDue - paidAmount) * 100) / 100;
      const status = existing.status || (balance <= 0 && paidAmount > 0 ? "Paid" : deductions.some(item => item.status === "Disputed") ? "Disputed" : "Draft");
      const mode = dataModeSummaryServer([existing, agreement, ...lines.flatMap(row => [row.daily, row.line, row.ledger])]);
      return {
        dataMode: mode.dataMode,
        sourceSummary: mode.sourceSummary,
        settlementId,
        packageKey: pack.key,
        mapNtp: pack.projectId,
        workedDate: pack.workedDate,
        contractor: owner,
        billingCode: pack.code,
        lineCount: lines.length,
        agreementId: agreement.id,
        contractorShare: share,
        jacksonShare: Number(agreement.jacksonShare || Math.max(0, 100 - share)),
        grossAmount,
        deductionTotal,
        netDue,
        paidAmount,
        balance,
        status,
        paymentStatus: balance <= 0 && paidAmount > 0 ? "Paid" : paidAmount > 0 ? "Partially Paid" : "Unpaid"
      };
    });
  });
}

function contractorDeductionCsvRows(db) {
  return (db.contractorSettlementDeductions || []).map(row => ({
    dataMode: dataModeSummaryServer([row]).dataMode,
    sourceSummary: dataModeSummaryServer([row]).sourceSummary,
    deductionId: row.id,
    settlementId: row.settlementId,
    packageKey: row.packageKey,
    mapNtp: row.project,
    contractor: row.contractor,
    category: row.category,
    amount: row.amount,
    deductionDate: row.deductionDate,
    status: row.status,
    reason: row.reason,
    enteredBy: row.enteredBy
  }));
}

function contractorSettlementPaymentCsvRows(db) {
  return (db.contractorSettlementPayments || []).map(row => ({
    dataMode: dataModeSummaryServer([row]).dataMode,
    sourceSummary: dataModeSummaryServer([row]).sourceSummary,
    paymentId: row.id,
    settlementId: row.settlementId,
    packageKey: row.packageKey,
    mapNtp: row.project,
    contractor: row.contractor,
    amount: row.amount || row.actualAmount || 0,
    paymentDate: row.paymentDate || row.actualDate || "",
    reference: row.reference,
    status: row.status,
    paidBy: row.paidBy,
    note: row.note
  }));
}

function contractorAgreementCsvRows(db) {
  return (db.contractorAgreements || []).map(row => ({
    dataMode: dataModeSummaryServer([row]).dataMode,
    sourceSummary: dataModeSummaryServer([row]).sourceSummary,
    agreementId: row.id,
    contractor: row.contractor,
    status: row.status,
    effectiveDate: row.effectiveDate,
    contractorShare: row.contractorShare,
    jacksonShare: row.jacksonShare,
    basis: row.basis,
    rateVisibility: row.rateVisibility,
    priorAgreementId: row.priorAgreementId || "",
    notes: row.notes || ""
  }));
}

function billingPackageMoneySummaryServer(db, pack) {
  const receipts = (db.cashReceipts || []).filter(item => item.packageKey === pack.key || (pack.submission?.id && item.submission === pack.submission.id) || (pack.invoice?.id && item.invoice === pack.invoice.id));
  const squanPaid = receipts.filter(item => item.type === "SQUAN Package Payment").reduce((total, item) => total + Number(item.actualAmount || 0), 0);
  const holdback = receipts.filter(item => item.type === "SQUAN Holdback").reduce((total, item) => total + Number(item.actualAmount || 0), 0);
  const contractorPaid = receipts.filter(item => item.type === "Contractor Package Payment").reduce((total, item) => total + Number(item.actualAmount || 0), 0);
  const submittedValue = Number(pack.submission?.squanSubmittedValue ?? pack.snapshot?.squanSubmittedValue ?? pack.billableAmount ?? 0);
  const contractorPayable = Number(pack.snapshot?.contractorPayableSnapshot ?? pack.payableAmount ?? 0);
  return {
    squanPaid,
    holdback,
    contractorPaid,
    submittedValue,
    contractorPayable,
    squanVariance: submittedValue - squanPaid - holdback,
    contractorOpen: contractorPayable - contractorPaid
  };
}

function workflowRecordKeyServer(key = "") {
  return String(key || "PACKAGE").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toUpperCase() || "PACKAGE";
}

function billingPackageRecordIdServer(prefix, key) {
  const slug = workflowRecordKeyServer(key);
  return prefix ? `${prefix}-${slug}` : slug;
}

function upsertRecordServer(db, collection, record) {
  db[collection] = db[collection] || [];
  const index = db[collection].findIndex(item => item.id === record.id);
  if (index === -1) {
    db[collection].push(record);
    return record;
  }
  db[collection][index] = { ...db[collection][index], ...record };
  return db[collection][index];
}

function appendInlineNoteServer(existing, note) {
  const clean = String(note || "").trim();
  if (!clean) return existing || "";
  return existing ? `${existing} | ${clean}` : clean;
}

function packageSubmissionAttachmentListServer(pack) {
  return [
    `billing-package:${pack.key}`,
    ...pack.lines.map(item => `productionLines:${item.line.id}`),
    ...pack.lines.map(item => item.ledger?.id ? `billingLedger:${item.ledger.id}` : "").filter(Boolean),
    ...pack.dailyIds.map(id => `daily:${id}`)
  ];
}

function billingPackageMoneySnapshotServer(pack) {
  const submittedValue = Math.round(Number(pack.billableAmount || 0) * 100) / 100;
  const contractorPayable = Math.round(Number(pack.payableAmount || 0) * 100) / 100;
  const inHouseCost = Math.round(Number(pack.jobCostAmount || 0) * 100) / 100;
  return {
    squanSubmittedValue: submittedValue,
    squanPaidAmount: 0,
    squanPaymentVariance: submittedValue,
    squanHoldbackAmount: 0,
    squanHoldbackPolicy: "Not automatic. Record actual SQUAN holdback, retainage, short-pay, or variance when payment is received.",
    contractorPayableSnapshot: contractorPayable,
    contractorPaidAmount: 0,
    contractorPaymentStatus: contractorPayable ? "Unpaid" : "No contractor payable",
    inHouseCostSnapshot: inHouseCost,
    contractorTermsSnapshot: "Calculated from the current rate sheet/payable rules at package preparation; terms may change for future packages."
  };
}

function logWorkflowTransitionServer(db, transition, detail = {}) {
  const result = emitWorkflowEvent(db, {
    eventName: detail.eventName || transition,
    transitionName: transition,
    workflowType: detail.workflowType || "billing-package",
    aggregateType: detail.aggregateType || "billingPackage",
    aggregateId: detail.aggregateId || detail.packageKey || detail.project || detail.projectId || transition,
    packageKey: detail.packageKey || "",
    project: detail.project || detail.projectId || "",
    fromStatus: detail.fromStatus || "",
    toStatus: detail.toStatus || "",
    owner: detail.owner || "Billing",
    role: detail.role || "Billing",
    actor: detail.actor || detail.owner || "Billing",
    blockers: detail.blockedReasons || detail.blockers || [],
    relatedRecords: detail.relatedRecords || [],
    auditAction: detail.auditAction || transition,
    auditDetail: detail,
    notes: detail.notes || "",
    payload: detail.payload || {}
  }, { appendAudit });
  return db.workflowTransitions.find(item => item.workflowEventId === result.event.id);
}

function requireBillingPackageServer(db, packageKey) {
  const pack = billingPackageWorkflowRowsServer(db).find(item => item.key === packageKey);
  if (!pack) {
    const error = new Error(`No billing package found for ${packageKey}`);
    error.statusCode = 404;
    throw error;
  }
  return pack;
}

function createBillingPackageSnapshotServer(db, pack, actor = "Billing") {
  const blockers = pack.blockers || [];
  if (blockers.length) {
    const error = new Error(`Package has blockers: ${blockers.join("; ")}`);
    error.statusCode = 409;
    error.blockers = blockers;
    throw error;
  }
  const now = new Date().toISOString();
  const priorSnapshots = (db.packageSnapshots || []).filter(item => item.scope === "SQUAN Billing Package" && item.packageKey === pack.key);
  const activeSnapshot = priorSnapshots.find(item => item.status !== "Superseded");
  const shouldCreateNewVersion = activeSnapshot?.status === "Rejected by SQUAN" || activeSnapshot?.correctionRequested === "Yes";
  const nextVersion = shouldCreateNewVersion ? Math.max(1, ...priorSnapshots.map(item => Number(item.version || 1))) + 1 : Number(activeSnapshot?.version || 1);
  const baseSnapshotId = billingPackageRecordIdServer("PKG", pack.key);
  const snapshotId = nextVersion > 1 ? `${baseSnapshotId}-V${nextVersion}` : baseSnapshotId;
  if (shouldCreateNewVersion && activeSnapshot) {
    activeSnapshot.status = "Superseded";
    activeSnapshot.supersededBy = snapshotId;
    activeSnapshot.modifiedAt = now;
    activeSnapshot.activityLog = [...(activeSnapshot.activityLog || []), { at: now, by: actor, note: `Superseded by correction package v${nextVersion}.` }];
  }
  const existingSnapshot = (db.packageSnapshots || []).find(item => item.id === snapshotId);
  const invoiceId = billingPackageRecordIdServer("INV", pack.key);
  const existingInvoice = (db.invoices || []).find(item => item.id === invoiceId);
  const money = billingPackageMoneySnapshotServer(pack);
  const rateAuditRows = pack.lines.map(row => ({
    productionLineId: row.line.id || "",
    billingLedgerId: row.ledger.id || "",
    code: row.line.code || pack.code,
    description: row.line.unitName || row.line.mapLayer || "",
    uom: row.line.uom || "",
    ...rateAuditForPackageLineServer(db, pack, row)
  }));
  const rateBlockers = rateAuditRows.flatMap(item => item.rateAuditIssues ? item.rateAuditIssues.split("; ").map(issue => `${item.code}: ${issue}`) : []);
  const invoice = upsertRecordServer(db, "invoices", {
    ...(existingInvoice || {}),
    id: invoiceId,
    project: pack.projectId,
    packageKey: pack.key,
    submitted: existingInvoice?.submitted || "",
    paid90: Number(existingInvoice?.paid90 || 0),
    retainageRelease: existingInvoice?.retainageRelease || "",
    gross: pack.billableAmount,
    ...money,
    retainage10: Number(existingInvoice?.retainage10 || 0),
    status: "Ready to Submit",
    support: "Prepared from approved Daily Capture billing package.",
    rateAuditStatus: rateBlockers.length ? "Needs Review" : "Matched",
    rateAuditBlockers: rateBlockers,
    notes: appendInlineNoteServer(existingInvoice?.notes, `Prepared package ${snapshotId} for ${pack.code} on ${pack.workedDate}.`),
    activityLog: existingInvoice?.activityLog || [],
    createdAt: existingInvoice?.createdAt || now,
    modifiedAt: now
  });
  const snapshot = upsertRecordServer(db, "packageSnapshots", {
    ...(existingSnapshot || {}),
    id: snapshotId,
    scope: "SQUAN Billing Package",
    packageKey: pack.key,
    project: pack.projectId,
    map: pack.project?.map || pack.projectId,
    code: pack.code,
    workedDate: pack.workedDate,
    invoice: invoice.id,
    version: existingSnapshot?.version || nextVersion,
    status: "Ready to Submit",
    locked: existingSnapshot?.locked || "No",
    correctionOf: shouldCreateNewVersion ? activeSnapshot?.id || "" : existingSnapshot?.correctionOf || "",
    preparedBy: actor,
    preparedAt: existingSnapshot?.preparedAt || now,
    gross: pack.billableAmount,
    netDue: money.squanSubmittedValue,
    retainageAmount: Number(existingSnapshot?.retainageAmount || 0),
    ...money,
    quantity: pack.quantity,
    uom: pack.lines[0]?.line?.uom || "",
    lineCount: pack.lineCount,
    proofAccepted: pack.proofAccepted,
    owners: pack.owners,
    dailyIds: pack.dailyIds,
    productionLineIds: pack.lines.map(item => item.line.id).filter(Boolean),
    billingLedgerIds: pack.lines.map(item => item.ledger.id).filter(Boolean),
    submittedLineSnapshots: pack.lines.map(item => ({
      productionLineId: item.line.id || "",
      billingLedgerId: item.ledger.id || "",
      dailyId: item.daily.externalDailyId || item.daily.id || item.line.dailyId || "",
      foreman: item.daily.submittedBy || item.line.submittedBy || "",
      mapNtp: pack.projectId,
      workedDate: pack.workedDate,
      code: item.line.code || pack.code,
      description: item.line.unitName || "",
      quantity: Number(item.line.quantity || item.ledger.quantity || 0),
      uom: item.line.uom || "",
      rate: Number(item.line.unitRate || 0),
      extendedAmount: Number(item.ledger.squanBillableAmount || item.line.submittedAmount || 0),
      contractorPayableAmount: Number(item.ledger.contractorPayableAmount || 0),
      proofStatus: item.proofState,
      reviewStatus: item.line.reviewStatus || "",
      billingStatus: item.ledger.billingStatus || item.line.billableStatus || ""
    })),
    squanTrackerRecordRows: squanTrackerRecordCsvRows([{ ...pack, snapshot: existingSnapshot || { id: snapshotId, version: nextVersion } }], db),
    exportPurpose: "Recordkeeping CSV for manual outside SQUAN Tracker entry; not a direct SQUAN integration.",
    rateAuditRows,
    rateAuditStatus: rateBlockers.length ? "Needs Review" : "Matched",
    rateAuditBlockers: rateBlockers,
    rateLockedAt: existingSnapshot?.rateLockedAt || now,
    rateLockedBy: existingSnapshot?.rateLockedBy || actor,
    attachments: packageSubmissionAttachmentListServer(pack),
    blockers: [...new Set([...(pack.blockers || []), ...rateBlockers])],
    notes: `Ready-to-submit SQUAN billing package for ${pack.projectId}, ${pack.workedDate}, ${pack.code}.`,
    activityLog: [
      ...(existingSnapshot?.activityLog || []),
      { at: now, by: actor, note: "Package prepared for SQUAN submission." }
    ],
    createdAt: existingSnapshot?.createdAt || now,
    modifiedAt: now
  });
  logWorkflowTransitionServer(db, "billing.package.prepare", {
    packageKey: pack.key,
    project: pack.projectId,
    fromStatus: pack.status,
    toStatus: snapshot.status,
    owner: actor,
    relatedRecords: [snapshot.id, invoice.id, ...snapshot.productionLineIds, ...snapshot.billingLedgerIds],
    auditAction: "billing.package.prepare.server"
  });
  return { snapshot, invoice };
}

function submitBillingPackageWorkflowServer(db, packageKey, details = {}, actor = "Billing") {
  let pack = requireBillingPackageServer(db, packageKey);
  const snapshot = pack.snapshot || createBillingPackageSnapshotServer(db, pack, actor).snapshot;
  pack = requireBillingPackageServer(db, packageKey);
  const invoice = (db.invoices || []).find(item => item.id === snapshot.invoice);
  const now = new Date().toISOString();
  const submittedValue = Number(details.packageValue ?? snapshot.squanSubmittedValue ?? pack.billableAmount ?? 0);
  const submissionId = billingPackageRecordIdServer("SUB", pack.key);
  const existing = (db.invoiceSubmissions || []).find(item => item.id === submissionId);
  const submissionDate = details.submissionDate || todayIso();
  const submission = upsertRecordServer(db, "invoiceSubmissions", {
    ...(existing || {}),
    id: submissionId,
    project: pack.projectId,
    packageKey: pack.key,
    packageSnapshot: snapshot.id,
    invoice: invoice?.id || snapshot.invoice,
    invoiceNumber: invoice?.id || snapshot.invoice,
    submittedTo: "SQUAN",
    submissionMode: "Manual SQUAN Tracker entry",
    directIntegration: "No",
    submissionDate,
    submittedBy: actor,
    squanBillingContact: details.contact || "SQUAN PM / AP",
    gross: submittedValue,
    squanSubmittedValue: submittedValue,
    squanPaidAmount: Number(existing?.squanPaidAmount || 0),
    squanPaymentVariance: submittedValue - Number(existing?.squanPaidAmount || 0),
    squanHoldbackAmount: Number(existing?.squanHoldbackAmount || 0),
    squanHoldbackPolicy: snapshot.squanHoldbackPolicy,
    contractorPayableSnapshot: snapshot.contractorPayableSnapshot,
    contractorPaidAmount: Number(existing?.contractorPaidAmount || 0),
    contractorPaymentStatus: existing?.contractorPaymentStatus || snapshot.contractorPaymentStatus,
    expectedPaymentAmount: submittedValue,
    retainage10: Number(existing?.retainage10 || 0),
    supportPackageStatus: "Submitted",
    status: "Submitted to SQUAN",
    deliveryMethod: details.method || "Manual entry into outside SQUAN Tracker",
    confirmationNumber: details.confirmationNumber || "",
    followUpDate: details.followUpDate || addDays(submissionDate, 14),
    followUpStatus: details.confirmationNumber ? "Receipt recorded" : "Receipt pending",
    attachmentsSent: snapshot.attachments || packageSubmissionAttachmentListServer(pack),
    receipt: {
      confirmationNumber: details.confirmationNumber || "",
      submittedBy: actor,
      receivedBy: details.contact || "SQUAN PM / AP",
      method: details.method || "Manual entry into outside SQUAN Tracker",
      receivedAt: details.confirmationNumber ? now : "",
      packageValue: submittedValue,
      followUpDate: details.followUpDate || addDays(submissionDate, 14),
      followUpStatus: details.confirmationNumber ? "Receipt recorded" : "Receipt pending",
      notes: details.note || "Jackson billing package data prepared for manual entry into the outside SQUAN Tracker. CSV retained for recordkeeping."
    },
    notes: appendInlineNoteServer(existing?.notes, details.note || "Manual SQUAN Tracker submission recorded."),
    activityLog: [
      ...(existing?.activityLog || []),
      { at: now, by: actor, note: "Manual SQUAN Tracker submission recorded." }
    ],
    createdAt: existing?.createdAt || now,
    modifiedAt: now
  });
  if (invoice) {
    invoice.status = "Submitted to SQUAN";
    invoice.submitted = submission.submissionDate;
    invoice.gross = submittedValue;
    invoice.squanSubmittedValue = submittedValue;
    invoice.modifiedAt = now;
  }
  Object.assign(snapshot, {
    status: "Submitted to SQUAN",
    locked: "Yes",
    lockedAt: snapshot.lockedAt || now,
    lockedBy: snapshot.lockedBy || actor,
    submission: submission.id,
    submittedAt: now,
    modifiedAt: now,
    activityLog: [...(snapshot.activityLog || []), { at: now, by: actor, note: "Package submitted to SQUAN." }]
  });
  pack.lines.forEach(item => {
    const lock = { packageKey: pack.key, snapshot: snapshot.id, submission: submission.id, lockedAt: now, lockedBy: actor };
    if (item.line) Object.assign(item.line, { billingPackageLock: lock, modifiedAt: now });
    if (item.ledger) Object.assign(item.ledger, { billingPackageLock: lock, modifiedAt: now });
  });
  logWorkflowTransitionServer(db, "billing.package.submit", {
    packageKey: pack.key,
    project: pack.projectId,
    fromStatus: pack.status,
    toStatus: submission.status,
    owner: actor,
    relatedRecords: [snapshot.id, submission.id, invoice?.id || ""].filter(Boolean),
    auditAction: "billing.package.manual-tracker-submission.server"
  });
  return { snapshot, invoice, submission };
}

function recordBillingPackageResponseServer(db, packageKey, details = {}, actor = "Billing") {
  const pack = requireBillingPackageServer(db, packageKey);
  const submission = pack.submission;
  if (!submission) {
    const error = new Error("Package must be submitted before recording a SQUAN response.");
    error.statusCode = 409;
    throw error;
  }
  const now = new Date().toISOString();
  const snapshot = pack.snapshot || (db.packageSnapshots || []).find(item => item.id === submission.packageSnapshot);
  const invoice = pack.invoice || (db.invoices || []).find(item => item.id === submission.invoice);
  const status = details.status || "Approved by SQUAN";
  const isReject = status === "Rejected by SQUAN" || details.action === "reject-squan";
  const submittedValue = Number(submission.squanSubmittedValue || pack.billableAmount || 0);
  const approvedAmount = isReject ? 0 : Number(details.approvedAmount ?? submittedValue);
  const variance = submittedValue - approvedAmount;
  const note = String(details.note || (isReject ? "Correction required before resubmission." : "Approved by SQUAN")).trim();
  Object.assign(submission, {
    status: isReject ? "Rejected by SQUAN" : status,
    supportPackageStatus: isReject ? "Needs Correction" : "Approved",
    approvedAmount,
    responseVariance: isReject ? submittedValue : variance,
    rejectionReason: isReject ? note : "",
    followUpDate: details.followUpDate || submission.followUpDate,
    followUpStatus: isReject ? "Correction required" : Math.abs(variance) > 0.01 ? "Variance review" : status,
    notes: appendInlineNoteServer(submission.notes, note),
    activityLog: [...(submission.activityLog || []), { at: now, by: actor, note }],
    modifiedAt: now
  });
  [invoice, snapshot].filter(Boolean).forEach(record => {
    record.status = submission.status;
    record.approvedAmount = approvedAmount;
    record.responseVariance = submission.responseVariance;
    record.responseNote = note;
    if (snapshot && record.id === snapshot.id) record.correctionRequested = isReject || Math.abs(variance) > 0.01 || status === "Partially approved by SQUAN" ? "Yes" : record.correctionRequested || "No";
    record.notes = appendInlineNoteServer(record.notes, note);
    record.activityLog = [...(record.activityLog || []), { at: now, by: actor, note: `SQUAN response: ${note}` }];
    record.modifiedAt = now;
  });
  if (isReject || Math.abs(variance) > 0.01 || status === "Partially approved by SQUAN") {
    upsertRecordServer(db, "tasks", {
      id: billingPackageRecordIdServer(isReject ? "TASK-SQUAN-REJECT" : "TASK-SQUAN-VARIANCE", pack.key),
      project: pack.projectId,
      title: isReject ? "Correct rejected SQUAN billing package" : "Review partial SQUAN approval variance",
      owner: "Office Billing",
      role: "Billing",
      status: "Open",
      source: isReject ? "SQUAN rejection" : "SQUAN partial approval",
      notes: `${pack.projectId} ${pack.code} ${pack.workedDate}: ${note}`,
      relatedType: "Invoice Submission",
      relatedId: submission.id,
      packageKey: pack.key,
      activityLog: [{ at: now, by: actor, note: "Workflow task created from SQUAN response." }],
      createdAt: now,
      modifiedAt: now
    });
  }
  logWorkflowTransitionServer(db, isReject ? "billing.package.reject" : "billing.package.response", {
    packageKey: pack.key,
    project: pack.projectId,
    fromStatus: pack.status,
    toStatus: submission.status,
    owner: actor,
    relatedRecords: [submission.id, snapshot?.id || "", invoice?.id || ""].filter(Boolean),
    auditAction: isReject ? "billing.package.reject-squan.server" : "billing.package.response.server"
  });
  return { snapshot, invoice, submission };
}

function recordBillingPackagePaymentServer(db, packageKey, details = {}, actor = "Billing") {
  const pack = requireBillingPackageServer(db, packageKey);
  const snapshot = pack.snapshot || createBillingPackageSnapshotServer(db, pack, actor).snapshot;
  const invoice = pack.invoice || (db.invoices || []).find(item => item.id === snapshot.invoice);
  const submission = pack.submission || (db.invoiceSubmissions || []).find(item => item.packageKey === pack.key || (invoice?.id && item.invoice === invoice.id));
  const now = new Date().toISOString();
  const type = details.type || "SQUAN Package Payment";
  const isContractor = type === "Contractor Package Payment";
  const isHoldback = type === "SQUAN Holdback";
  const summary = billingPackageMoneySummaryServer(db, pack);
  const expected = isContractor ? Math.max(0, summary.contractorOpen) : isHoldback ? 0 : Math.max(0, summary.submittedValue - summary.squanPaid - summary.holdback);
  const actualAmount = Number(details.actualAmount || 0);
  if (!Number.isFinite(actualAmount) || actualAmount < 0) {
    const error = new Error("Enter a valid payment amount.");
    error.statusCode = 400;
    throw error;
  }
  const actualDate = details.actualDate || todayIso();
  const receipt = {
    id: `${isContractor ? "PAY-CONTRACTOR" : isHoldback ? "HOLD-SQUAN" : "PAY-SQUAN"}-${workflowRecordKeyServer(pack.key)}-${Date.now()}`,
    project: pack.projectId,
    packageKey: pack.key,
    packageSnapshot: snapshot.id,
    invoice: invoice?.id || snapshot.invoice || "",
    submission: submission?.id || "",
    type,
    expectedDate: submission?.followUpDate || "",
    actualDate,
    expectedAmount: expected,
    actualAmount,
    variance: isHoldback ? actualAmount : actualAmount - expected,
    reserveHeld: isHoldback ? (details.reserveHeld ? "Yes" : "No") : "",
    holdbackReason: isHoldback ? (details.holdbackReason || details.note || "SQUAN/customer held back part of this package.") : "",
    expectedReleaseDate: isHoldback ? String(details.expectedReleaseDate || "") : "",
    releaseStatus: isHoldback ? "Manual follow-up required" : "",
    status: actualAmount <= 0 ? "Open" : actualAmount < expected ? "Partially Paid" : actualAmount > expected && !isHoldback ? "Overpaid" : isHoldback ? "Holdback Recorded" : "Paid",
    reference: details.reference || `${type.toUpperCase().replace(/[^A-Z0-9]+/g, "-")}-${workflowRecordKeyServer(pack.key)}`,
    bankProof: String(details.bankProof || ""),
    depositBatch: isContractor ? "" : `DEP-${actualDate}`,
    depositStatus: isContractor ? "Contractor payment recorded" : "Pending Bank Proof",
    receivedBy: actor,
    receivedAt: now,
    notes: details.note || `${type} recorded from package ledger.`,
    activityLog: [{ at: now, by: actor, note: `${type} recorded for ${actualAmount}.` }],
    createdAt: now,
    modifiedAt: now
  };
  db.cashReceipts = db.cashReceipts || [];
  db.cashReceipts.push(receipt);
  const nextSummary = {
    ...summary,
    squanPaid: summary.squanPaid + (type === "SQUAN Package Payment" ? actualAmount : 0),
    holdback: summary.holdback + (type === "SQUAN Holdback" ? actualAmount : 0),
    contractorPaid: summary.contractorPaid + (type === "Contractor Package Payment" ? actualAmount : 0)
  };
  nextSummary.squanVariance = nextSummary.submittedValue - nextSummary.squanPaid - nextSummary.holdback;
  nextSummary.contractorOpen = nextSummary.contractorPayable - nextSummary.contractorPaid;
  const squanStatus = nextSummary.squanVariance === 0 && nextSummary.squanPaid > 0 ? "Paid" : nextSummary.squanPaid > 0 || nextSummary.holdback > 0 ? "Partially Paid" : pack.status;
  const contractorStatus = nextSummary.contractorPayable <= 0 ? "No contractor payable" : nextSummary.contractorOpen <= 0 ? "Paid" : nextSummary.contractorPaid > 0 ? "Partially Paid" : "Unpaid";
  [snapshot, invoice, submission].filter(Boolean).forEach(record => {
    record.squanPaidAmount = nextSummary.squanPaid;
    record.squanHoldbackAmount = nextSummary.holdback;
    record.squanPaymentVariance = nextSummary.squanVariance;
    record.contractorPaidAmount = nextSummary.contractorPaid;
    record.contractorPaymentStatus = contractorStatus;
    record.paymentStatus = squanStatus;
    if (isHoldback) {
      record.reserveHeld = details.reserveHeld ? "Yes" : "No";
      record.reserveHeldAmount = nextSummary.holdback;
      record.reserveHeldReason = details.holdbackReason || receipt.notes;
      record.reserveExpectedReleaseDate = String(details.expectedReleaseDate || "");
    }
    record.modifiedAt = now;
  });
  if (invoice) invoice.status = squanStatus;
  if (submission) submission.status = squanStatus === "Paid" ? "Paid by SQUAN" : submission.status || "Submitted to SQUAN";
  logWorkflowTransitionServer(db, isContractor ? "billing.package.contractor-payment" : isHoldback ? "billing.package.holdback" : "billing.package.squan-payment", {
    packageKey: pack.key,
    project: pack.projectId,
    fromStatus: pack.status,
    toStatus: squanStatus,
    owner: actor,
    relatedRecords: [receipt.id, snapshot?.id || "", invoice?.id || "", submission?.id || ""].filter(Boolean),
    auditAction: isContractor ? "billing.package.contractor-payment.server" : isHoldback ? "billing.package.holdback.server" : "billing.package.squan-payment.server"
  });
  return { snapshot, invoice, submission, receipt };
}

function billingPackageRateIssuesServer(db, pack) {
  return pack.lines.flatMap(row => {
    const audit = rateAuditForPackageLineServer(db, pack, row);
    return audit.rateAuditIssues ? audit.rateAuditIssues.split("; ").map(issue => ({ code: pack.code, issue })) : [];
  });
}

function billingPackageNextActionServer(db, pack, money = billingPackageMoneySummaryServer(db, pack)) {
  const rateIssues = billingPackageRateIssuesServer(db, pack);
  if (pack.blockers.length || rateIssues.length) return "Clear blockers / rate audit";
  if (!pack.snapshot && !pack.invoice) return "Prepare package";
  if (!pack.submission) return "Record manual SQUAN Tracker submission";
  if (pack.submission.status === "Rejected by SQUAN") return "Correct and resubmit";
  if (money.squanPaid <= 0 && money.holdback <= 0) return "Record SQUAN payment";
  if (Math.abs(money.squanVariance) > 0.01) return "Resolve SQUAN variance / holdback";
  if (money.contractorOpen > 0) return "Record contractor payment";
  return "Closed / monitor";
}

function billingPackageLifecycleCsvRows(db) {
  return billingPackageWorkflowRowsServer(db).map(pack => {
    const money = billingPackageMoneySummaryServer(db, pack);
    const rateIssues = billingPackageRateIssuesServer(db, pack);
    const mode = dataModeSummaryServer([pack.snapshot || {}, pack.submission || {}, ...pack.lines.flatMap(row => [row.daily, row.line, row.ledger])]);
    return {
      dataMode: mode.dataMode,
      sourceSummary: mode.sourceSummary,
      packageKey: pack.key,
      mapNtp: pack.projectId,
      workedDate: pack.workedDate,
      code: pack.code,
      foreman: pack.owners.join("; "),
      quantity: pack.quantity,
      squanSubmittedValue: money.submittedValue,
      rateAuditStatus: rateIssues.length ? "Needs Review" : "Matched",
      packageStatus: pack.status,
      submissionStatus: pack.submission?.status || "",
      approvedAmount: pack.submission?.approvedAmount || "",
      responseVariance: pack.submission?.responseVariance || "",
      squanPaidAmount: money.squanPaid,
      squanVariance: money.squanVariance,
      squanHoldbackAmount: money.holdback,
      contractorPayableAmount: money.contractorPayable,
      contractorPaidAmount: money.contractorPaid,
      nextAction: billingPackageNextActionServer(db, pack, money)
    };
  });
}

function billingPackageExceptionCsvRows(db) {
  return billingPackageWorkflowRowsServer(db).flatMap(pack => {
    const money = billingPackageMoneySummaryServer(db, pack);
    const mode = dataModeSummaryServer([pack.snapshot || {}, pack.submission || {}, ...pack.lines.flatMap(row => [row.daily, row.line, row.ledger])]);
    const base = { dataMode: mode.dataMode, sourceSummary: mode.sourceSummary };
    const rows = [];
    pack.blockers.forEach(blocker => rows.push({ ...base, packageKey: pack.key, mapNtp: pack.projectId, workedDate: pack.workedDate, code: pack.code, exceptionType: "Blocker", detail: blocker, owner: pack.owners.join("; ") || "Billing", amount: "", nextAction: "Clear blocker" }));
    billingPackageRateIssuesServer(db, pack).forEach(item => rows.push({ ...base, packageKey: pack.key, mapNtp: pack.projectId, workedDate: pack.workedDate, code: pack.code, exceptionType: "Rate audit", detail: item.issue, owner: "Billing", amount: "", nextAction: "Review rate / override" }));
    if (pack.submission?.status === "Rejected by SQUAN") rows.push({ ...base, packageKey: pack.key, mapNtp: pack.projectId, workedDate: pack.workedDate, code: pack.code, exceptionType: "SQUAN rejection", detail: pack.submission.rejectionReason || "Rejected by SQUAN", owner: "Billing", amount: money.submittedValue, nextAction: "Correct and resubmit" });
    if (pack.submission?.status === "Partially approved by SQUAN" || Math.abs(Number(pack.submission?.responseVariance || 0)) > 0.01) rows.push({ ...base, packageKey: pack.key, mapNtp: pack.projectId, workedDate: pack.workedDate, code: pack.code, exceptionType: "SQUAN partial approval", detail: "Approved amount does not match submitted package value", owner: "Billing", amount: pack.submission?.responseVariance || "", nextAction: "Review partial approval variance" });
    if (money.squanPaid > 0 && Math.abs(money.squanVariance) > 0.01) rows.push({ ...base, packageKey: pack.key, mapNtp: pack.projectId, workedDate: pack.workedDate, code: pack.code, exceptionType: "SQUAN variance", detail: "Paid amount does not close submitted value", owner: "Billing", amount: money.squanVariance, nextAction: "Resolve variance / holdback" });
    if (money.contractorOpen > 0) rows.push({ ...base, packageKey: pack.key, mapNtp: pack.projectId, workedDate: pack.workedDate, code: pack.code, exceptionType: "Contractor payable", detail: "Contractor balance remains open", owner: pack.owners.join("; ") || "Billing", amount: money.contractorOpen, nextAction: "Record contractor payment" });
    return rows;
  });
}

function findRecord(db, collection, id) {
  if (!collections.has(collection)) return {};
  const rows = db[collection] || [];
  const index = rows.findIndex(item => item.id === id);
  return { rows, index, record: index === -1 ? null : rows[index] };
}

function updateRecord(db, collection, id, patch) {
  const found = findRecord(db, collection, id);
  if (!found.record) return null;
  const next = {
    ...found.record,
    ...patch,
    id,
    modifiedAt: new Date().toISOString()
  };
  found.rows[found.index] = next;
  return next;
}

function addNote(db, collection, id, note, by = "User") {
  const found = findRecord(db, collection, id);
  if (!found.record) return null;
  const entry = { at: new Date().toISOString(), by, note };
  const next = updateRecord(db, collection, id, {
    notes: found.record.notes ? `${found.record.notes} | ${note}` : note,
    activityLog: [...(found.record.activityLog || []), entry]
  });
  appendAudit(db, `${collection}.note`, { id, by });
  return next;
}

function changeStatus(db, collection, id, status, by = "System") {
  const next = updateRecord(db, collection, id, {
    status,
    activityLog: [
      ...((findRecord(db, collection, id).record || {}).activityLog || []),
      { at: new Date().toISOString(), by, note: `Status changed to ${status}` }
    ]
  });
  if (next) appendAudit(db, `${collection}.status`, { id, status, by });
  return next;
}

function numberValue(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

function updateCashControls(db, body = {}) {
  const now = new Date().toISOString();
  const company = db.company || {};
  const previous = {
    cashOnHand: numberValue(company.cashOnHand),
    weeklyOverhead: numberValue(company.weeklyOverhead),
    minimumCashThreshold: numberValue(company.minimumCashThreshold),
    cashScenarioDelays: { ...(company.cashScenarioDelays || {}) }
  };
  const delays = body.cashScenarioDelays || {};
  const next = {
    ...company,
    cashOnHand: numberValue(body.cashOnHand, previous.cashOnHand),
    weeklyOverhead: numberValue(body.weeklyOverhead, previous.weeklyOverhead),
    minimumCashThreshold: numberValue(body.minimumCashThreshold, previous.minimumCashThreshold),
    cashScenarioDelays: {
      baseline: numberValue(delays.baseline, 0),
      delay15: numberValue(delays.delay15, 15),
      delay30: numberValue(delays.delay30, 30),
      delay45: numberValue(delays.delay45, 45)
    },
    modifiedAt: now
  };
  next.cashControlHistory = [
    ...(company.cashControlHistory || []),
    {
      at: now,
      by: body.by || "Admin",
      cashOnHand: next.cashOnHand,
      weeklyOverhead: next.weeklyOverhead,
      minimumCashThreshold: next.minimumCashThreshold,
      cashScenarioDelays: { ...next.cashScenarioDelays },
      previous,
      notes: "Admin updated cash forecast control assumptions."
    }
  ];
  db.company = next;
  appendAudit(db, "settings.cash-controls", {
    by: body.by || "Admin",
    cashOnHand: next.cashOnHand,
    weeklyOverhead: next.weeklyOverhead,
    minimumCashThreshold: next.minimumCashThreshold,
    cashScenarioDelays: next.cashScenarioDelays
  });
  return next;
}

function closeoutReadinessSlaDefaults(company = {}) {
  const settings = company.closeoutReadinessSla || {};
  return {
    warningDays: numberValue(settings.warningDays, 2),
    escalationDays: numberValue(settings.escalationDays, 3),
    handoffAgingDays: numberValue(settings.handoffAgingDays, 2),
    ownerMismatchEscalates: settings.ownerMismatchEscalates || "Yes"
  };
}

function dailyPackageSlaDefaults(company = {}) {
  const settings = company.dailyPackageSla || {};
  return {
    agingDays: numberValue(settings.agingDays, 1),
    escalationDays: numberValue(settings.escalationDays, 2),
    returnedOwner: settings.returnedOwner || "Foreman",
    readyOwner: settings.readyOwner || "Billing"
  };
}

function updateCloseoutReadinessSlaControls(db, body = {}) {
  const now = new Date().toISOString();
  const company = db.company || {};
  const previous = closeoutReadinessSlaDefaults(company);
  const incoming = body.closeoutReadinessSla || {};
  const nextSla = {
    warningDays: numberValue(incoming.warningDays, previous.warningDays),
    escalationDays: numberValue(incoming.escalationDays, previous.escalationDays),
    handoffAgingDays: numberValue(incoming.handoffAgingDays, previous.handoffAgingDays),
    ownerMismatchEscalates: incoming.ownerMismatchEscalates || previous.ownerMismatchEscalates
  };
  if (nextSla.escalationDays < nextSla.warningDays) nextSla.escalationDays = nextSla.warningDays;
  const next = {
    ...company,
    closeoutReadinessSla: nextSla,
    modifiedAt: now
  };
  next.closeoutReadinessSlaHistory = [
    ...(company.closeoutReadinessSlaHistory || []),
    {
      at: now,
      by: body.by || "Admin",
      closeoutReadinessSla: { ...nextSla },
      previous,
      notes: "Admin updated closeout readiness SLA controls."
    }
  ];
  db.company = next;
  appendAudit(db, "settings.closeout-readiness-sla", {
    by: body.by || "Admin",
    closeoutReadinessSla: nextSla,
    previous
  });
  return next;
}

function updateDailyPackageSlaControls(db, body = {}) {
  const now = new Date().toISOString();
  const company = db.company || {};
  const previous = dailyPackageSlaDefaults(company);
  const incoming = body.dailyPackageSla || {};
  const nextSla = {
    agingDays: numberValue(incoming.agingDays, previous.agingDays),
    escalationDays: numberValue(incoming.escalationDays, previous.escalationDays),
    returnedOwner: incoming.returnedOwner || previous.returnedOwner,
    readyOwner: incoming.readyOwner || previous.readyOwner
  };
  if (nextSla.escalationDays < nextSla.agingDays) nextSla.escalationDays = nextSla.agingDays;
  const next = {
    ...company,
    dailyPackageSla: nextSla,
    modifiedAt: now
  };
  next.dailyPackageSlaHistory = [
    ...(company.dailyPackageSlaHistory || []),
    {
      at: now,
      by: body.by || "Admin",
      dailyPackageSla: { ...nextSla },
      previous,
      notes: "Admin updated daily package SLA controls."
    }
  ];
  db.company = next;
  appendAudit(db, "settings.daily-package-sla", {
    by: body.by || "Admin",
    dailyPackageSla: nextSla,
    previous
  });
  return next;
}

function upsertById(rows, record) {
  if (!record?.id) return null;
  const index = rows.findIndex(item => item.id === record.id);
  if (index === -1) rows.push(record);
  else rows[index] = { ...rows[index], ...record, id: record.id };
  return index === -1 ? record : rows[index];
}

async function handleApi(req, res, url) {
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, {
      ok: true,
      app: "Jackson Telcom ERP",
      dataDriver: DATA_DRIVER,
      database: DATA_DRIVER === "mysql" ? MYSQL_DATABASE : "data/db.json",
      demoAuth: DEMO_AUTH_ENABLED,
      productionMode: PRODUCTION_MODE,
      configReady: productionConfigFailures().length === 0
    });
  }

  if (req.method === "GET" && url.pathname === "/api/health/db") {
    try {
      const db = readDb();
      return send(res, 200, { ok: true, dataDriver: DATA_DRIVER, collections: Object.keys(db).length });
    } catch (error) {
      return send(res, 503, { ok: false, dataDriver: DATA_DRIVER, error: DEBUG_ERRORS ? error.message : "Database readiness check failed" });
    }
  }

  const db = readDb();

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await parseBody(req);
    if (!checkLoginRateLimit(req, body)) {
      logEvent("warn", "auth.rate_limited", { requestId: req.requestId, email: body.email || "", ip: clientIp(req) });
      return send(res, 429, { error: "Too many login attempts. Try again later." });
    }
    const user = db.users.find(item => item.email === body.email);
    if (!user || (user.status || "Active") === "Inactive") {
      logEvent("warn", "auth.failed", { requestId: req.requestId, email: body.email || "", ip: clientIp(req) });
      return send(res, 401, { error: "Invalid email or password" });
    }
    const passwordOk = DEMO_AUTH_ENABLED
      ? body.password === "demo"
      : verifyPasswordHash(body.password || "", user.passwordHash || "");
    if (!passwordOk) {
      logEvent("warn", "auth.failed", { requestId: req.requestId, email: user.email, ip: clientIp(req), reason: "bad_password" });
      return send(res, 401, { error: "Invalid email or password" });
    }
    if (!DEMO_AUTH_ENABLED && !user.passwordHash) return send(res, 403, { error: "Production password is not configured for this user" });
    clearLoginRateLimit(req, body);
    appendAudit(db, "auth.login", { user: user.email, by: user.name || user.email, ...auditContext(req) });
    writeDb(db);
    logEvent("info", "auth.login", { requestId: req.requestId, userId: user.id, role: user.role, ip: clientIp(req) });
    return send(res, 200, { user, token: issueAuthToken(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/password-reset/request") {
    const body = await parseBody(req);
    const user = (db.users || []).find(item => item.email === body.email && (item.status || "Active") !== "Inactive");
    if (user) {
      const issued = issuePasswordResetToken(db, user, req);
      writeDb(db);
      logEvent("info", "auth.password_reset_requested", { requestId: req.requestId, userId: user.id, ip: clientIp(req), deliveryConfigured: false });
      return send(res, 200, {
        ok: true,
        deliveryConfigured: false,
        resetId: issued.record.id,
        ...(PRODUCTION_MODE ? {} : { token: issued.token })
      });
    }
    logEvent("warn", "auth.password_reset_unknown_user", { requestId: req.requestId, email: body.email || "", ip: clientIp(req) });
    return send(res, 200, { ok: true, deliveryConfigured: false });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/password-reset/confirm") {
    const body = await parseBody(req);
    const result = consumePasswordResetToken(db, body.token || "", body.password || "", req);
    if (!result.ok) return send(res, result.status, { error: result.error });
    writeDb(db);
    return send(res, 200, { ok: true });
  }

  const user = authenticateRequest(req, db);
  if (!user) return send(res, 401, { error: "Authentication required" });
  req.user = user;
  if (!canAccessRoute(user, req, url)) return send(res, 403, { error: "Forbidden" });
  const liveBlocker = liveModeBlocker(db);
  if (liveBlocker && req.method !== "GET" && url.pathname !== "/api/admin/go-live-mode") {
    return send(res, 409, { error: liveBlocker });
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    return send(res, 200, { ...db, summary: summarize(db) });
  }

  if (req.method === "GET" && url.pathname === "/api/admin/backup") {
    return send(res, 200, backupPayload(db, requestActor(req, "Admin")));
  }

  if (req.method === "POST" && url.pathname === "/api/admin/restore/validate") {
    const body = await parseBody(req);
    const failures = validateBackupData(body.backup || body);
    return send(res, failures.length ? 400 : 200, { ok: failures.length === 0, failures });
  }

  if (req.method === "POST" && url.pathname === "/api/admin/restore") {
    if (!DEMO_AUTH_ENABLED && !ALLOW_ADMIN_RESTORE) return send(res, 403, { error: "Backup restore is disabled. Set ALLOW_ADMIN_RESTORE=true for a controlled restore window." });
    const body = await parseBody(req);
    if (body.confirm !== "RESTORE") return send(res, 400, { error: "Restore requires confirm: RESTORE" });
    const source = body.backup?.data && typeof body.backup.data === "object" ? body.backup.data : body.backup;
    const failures = validateBackupData(source);
    if (failures.length) return send(res, 400, { error: "Backup validation failed", failures });
    const nextDb = {
      ...source,
      auditLog: Array.isArray(source.auditLog) ? source.auditLog : []
    };
    appendAudit(nextDb, "admin.restore-backup", {
      by: requestActor(req, "Admin"),
      restoredAt: new Date().toISOString(),
      source: body.backup?.source || "Uploaded backup"
    });
    writeDb(nextDb);
    return send(res, 200, { ok: true, restoredAt: new Date().toISOString() });
  }

  if (req.method === "PUT" && url.pathname === "/api/admin/go-live-mode") {
    const body = await parseBody(req);
    const allowedModes = ["Demo Mode", "Review Mode", "Live Mode"];
    const mode = allowedModes.includes(body.mode) ? body.mode : "Review Mode";
    if (mode === "Live Mode" && DEMO_AUTH_ENABLED) {
      return send(res, 409, { error: "Live Mode requires DEMO_AUTH=false and production authentication." });
    }
    const readiness = operationalReadinessCsvRowsServer(db);
    const liveBlockers = readiness.filter(row => !["Operational Ready", "Ready for Review"].includes(row.status));
    if (mode === "Live Mode" && liveBlockers.length) {
      return send(res, 409, { error: "Live Mode blocked by readiness items", blockers: liveBlockers });
    }
    db.company = {
      ...(db.company || {}),
      goLiveMode: mode,
      goLiveModeUpdatedAt: new Date().toISOString(),
      goLiveModeUpdatedBy: requestActor(req, "Admin"),
      persistencePlan: body.persistencePlan || db.company?.persistencePlan || "Node server with JSON backup now; MAMP MySQL migration next"
    };
    appendAudit(db, "admin.go-live-mode", {
      by: requestActor(req, "Admin"),
      mode,
      persistencePlan: db.company.persistencePlan
    });
    writeDb(db);
    return send(res, 200, { company: db.company });
  }

  if (req.method === "POST" && url.pathname === "/api/records/update") {
    const body = await parseBody(req);
    if (!canAccessCollection(req.user, body.collection, "PUT")) return send(res, 403, { error: "Forbidden" });
    const before = beforeSnapshot(body.collection, findRecord(db, body.collection, body.id).record);
    const next = updateRecord(db, body.collection, body.id, body.patch || {});
    if (!next) return send(res, 404, { error: "Record not found" });
    appendAudit(db, `${body.collection}.update`, { id: body.id, by: requestActor(req), before, after: before ? beforeSnapshot(body.collection, next) : undefined, ...auditContext(req) });
    if (next.project) recomputeProject(db, next.project);
    writeDb(db);
    return send(res, 200, next);
  }

  if (req.method === "POST" && url.pathname === "/api/records/note") {
    const body = await parseBody(req);
    if (!canAccessCollection(req.user, body.collection, "PUT")) return send(res, 403, { error: "Forbidden" });
    const next = addNote(db, body.collection, body.id, body.note, requestActor(req, "User"));
    if (!next) return send(res, 404, { error: "Record not found" });
    writeDb(db);
    return send(res, 200, next);
  }

  if (req.method === "POST" && url.pathname === "/api/records/status") {
    const body = await parseBody(req);
    if (!canAccessCollection(req.user, body.collection, "PUT")) return send(res, 403, { error: "Forbidden" });
    const next = changeStatus(db, body.collection, body.id, body.status, requestActor(req, "System"));
    if (!next) return send(res, 404, { error: "Record not found" });
    if (next.project) recomputeProject(db, next.project);
    writeDb(db);
    return send(res, 200, next);
  }

  if (req.method === "PUT" && url.pathname === "/api/company/cash-controls") {
    const body = await parseBody(req);
    body.by = requestActor(req, "Admin");
    const company = updateCashControls(db, body);
    writeDb(db);
    return send(res, 200, {
      company,
      cashForecast: reportCashForecast(db, body.scenario || "baseline")
    });
  }

  if (req.method === "PUT" && url.pathname === "/api/company/closeout-readiness-sla") {
    const body = await parseBody(req);
    body.by = requestActor(req, "Admin");
    const company = updateCloseoutReadinessSlaControls(db, body);
    writeDb(db);
    return send(res, 200, { company });
  }

  if (req.method === "PUT" && url.pathname === "/api/company/daily-package-sla") {
    const body = await parseBody(req);
    body.by = requestActor(req, "Admin");
    const company = updateDailyPackageSlaControls(db, body);
    writeDb(db);
    return send(res, 200, { company });
  }

  if (req.method === "POST" && url.pathname === "/api/company/cash-receipts") {
    const body = await parseBody(req);
    const receipt = body.receipt || {};
    if (!receipt.id || !receipt.project) return send(res, 400, { error: "receipt.id and receipt.project are required" });
    const now = new Date().toISOString();
    db.cashReceipts = db.cashReceipts || [];
    db.invoices = db.invoices || [];
    db.invoiceSubmissions = db.invoiceSubmissions || [];
    db.collectionSubmissions = db.collectionSubmissions || [];
    db.retainageLedger = db.retainageLedger || [];
    const savedReceipt = upsertById(db.cashReceipts, { ...receipt, modifiedAt: now });
    if (body.invoice?.id) upsertById(db.invoices, { ...body.invoice, modifiedAt: now });
    if (body.submission?.id) upsertById(db.invoiceSubmissions, { ...body.submission, modifiedAt: now });
    if (body.collectionSubmission?.id) upsertById(db.collectionSubmissions, { ...body.collectionSubmission, modifiedAt: now });
    if (body.retainage?.id) upsertById(db.retainageLedger, { ...body.retainage, modifiedAt: now });
    db.company = db.company || {};
    if (Number.isFinite(Number(body.cashOnHand))) db.company.cashOnHand = Number(body.cashOnHand);
    db.company.cashReceiptHistory = [
      ...(db.company.cashReceiptHistory || []),
      {
        at: now,
        by: requestActor(req, receipt.receivedBy || "Billing"),
        project: receipt.project,
        invoice: receipt.invoice,
        type: receipt.type,
        actualAmount: Number(receipt.actualAmount || 0),
        expectedAmount: Number(receipt.expectedAmount || 0),
        variance: Number(receipt.actualAmount || 0) - Number(receipt.expectedAmount || 0),
        reference: receipt.reference || "",
        notes: "Cash receipt synced through ERP API."
      }
    ];
    appendAudit(db, "cash.receipt-reconciled", {
      id: receipt.id,
      project: receipt.project,
      invoice: receipt.invoice,
      type: receipt.type,
      actualAmount: Number(receipt.actualAmount || 0),
      variance: Number(receipt.actualAmount || 0) - Number(receipt.expectedAmount || 0)
    });
    writeDb(db);
    return send(res, 200, { receipt: savedReceipt, company: db.company });
  }

  if (req.method === "POST" && url.pathname === "/api/workflows/recompute") {
    const body = await parseBody(req);
    const project = recomputeProject(db, body.project);
    if (!project) return send(res, 404, { error: "Project not found" });
    appendAudit(db, "workflow.recompute", { project: body.project });
    writeDb(db);
    return send(res, 200, { project, readiness: db.billingReadiness.find(item => item.project === body.project) });
  }

  if (req.method === "POST" && url.pathname === "/api/workflows/daily-package-intake") {
    const body = await parseBody(req);
    body.by = requestActor(req, "Billing");
    const projectId = body.project || body.snapshot?.project || body.task?.project;
    if (!projectId) return send(res, 400, { error: "project is required" });
    const project = (db.projects || []).find(item => item.id === projectId);
    if (!project) return send(res, 404, { error: "Project not found" });
    const now = new Date().toISOString();
    db.packageSnapshots = db.packageSnapshots || [];
    db.tasks = db.tasks || [];
    if (body.snapshot?.id) {
      upsertById(db.packageSnapshots, {
        ...body.snapshot,
        modifiedAt: now,
        activityLog: [
          ...(body.snapshot.activityLog || []),
          {
            at: now,
            by: body.by || "Billing",
            note: `Server synced daily package intake ${body.decision || body.snapshot.billingIntake?.status || "update"}.`
          }
        ]
      });
    }
    (body.tasks || []).forEach(task => {
      if (!task.id) return;
      upsertById(db.tasks, {
        ...task,
        modifiedAt: now,
        activityLog: [
          ...(task.activityLog || []),
          {
            at: now,
            by: body.by || "Billing",
            note: "Server synced daily package intake task."
          }
        ]
      });
    });
    if (body.task?.id) {
      upsertById(db.tasks, {
        ...body.task,
        modifiedAt: now,
        activityLog: [
          ...(body.task.activityLog || []),
          {
            at: now,
            by: body.by || "Billing",
            note: "Server synced daily package intake task."
          }
        ]
      });
    }
    if (body.projectPatch) {
      Object.assign(project, body.projectPatch, { id: project.id, modifiedAt: now });
    }
    if (body.approvalLogEntry) {
      project.approvalLog = project.approvalLog || [];
      if (!project.approvalLog.some(item => item.at === body.approvalLogEntry.at && item.decision === body.approvalLogEntry.decision && item.reason === body.approvalLogEntry.reason)) {
        project.approvalLog.push(body.approvalLogEntry);
      }
      project.modifiedAt = now;
    }
    const recomputed = recomputeProject(db, project.id);
    appendAudit(db, "workflow.daily-package-intake", {
      project: project.id,
      packageId: body.snapshot?.id || body.task?.packageId || "",
      decision: body.decision || body.snapshot?.billingIntake?.status || body.task?.packageException?.status || "Synced",
      by: body.by || "Billing"
    });
    writeDb(db);
    return send(res, 200, {
      project: recomputed || project,
      snapshot: body.snapshot?.id ? (db.packageSnapshots || []).find(item => item.id === body.snapshot.id) : null,
      tasks: (db.tasks || []).filter(task => task.project === project.id && task.source === "Daily package intake"),
      dailyPackageExceptions: dailyPackageExceptionRows(db, project.id),
      readiness: (db.billingReadiness || []).find(item => item.project === project.id)
    });
  }

  if (req.method === "POST" && url.pathname === "/api/uploads/validate") {
    const body = await parseBody(req);
    const validation = validateUploadMetadata(body.file || body);
    if (!validation.ok) return send(res, 400, validation);
    db.uploadIntake = db.uploadIntake || [];
    const now = new Date().toISOString();
    const record = {
      id: `UPLOAD-${Date.now()}`,
      project: body.project || "",
      linkedRecord: body.linkedRecord || "",
      status: "Validated Metadata",
      file: validation.normalized,
      storageStatus: "Pending external private storage",
      requestedBy: requestActor(req),
      requestContext: auditContext(req),
      notes: "Upload metadata validated. Actual file storage/scanning must be handled by the configured external storage service.",
      activityLog: [],
      createdAt: now,
      modifiedAt: now
    };
    db.uploadIntake.push(record);
    appendAudit(db, "upload.metadata-validated", { id: record.id, by: requestActor(req), file: validation.normalized.name, ...auditContext(req) });
    writeDb(db);
    return send(res, 200, { ok: true, upload: record });
  }

  if (req.method === "POST" && url.pathname === "/api/workflows/submit-daily") {
    const body = await parseBody(req);
    const daily = body.daily || {};
    if (!daily.id || !daily.project) return send(res, 400, { error: "daily.id and daily.project are required" });

    const existingDailyIndex = db.dailies.findIndex(item => item.id === daily.id);
    const previousDailyStatus = existingDailyIndex === -1 ? "" : db.dailies[existingDailyIndex]?.status || "";
    const submittedDaily = {
      ...daily,
      status: "Submitted",
      jsa: daily.jsa || "Complete",
      output: daily.output || "SQUAN daily, SOT, photos, payroll, inventory posted"
    };
    if (existingDailyIndex === -1) db.dailies.push(submittedDaily);
    else db.dailies[existingDailyIndex] = { ...db.dailies[existingDailyIndex], ...submittedDaily };

    ["dailyProduction", "dailyLabor", "dailyEquipment", "dailyMaterials"].forEach(collection => {
      db[collection] = db[collection].filter(line => line.dailyId !== daily.id);
    });

    (body.production || []).forEach(line => db.dailyProduction.push({ ...line, dailyId: daily.id, project: daily.project }));
    (body.labor || []).forEach(line => db.dailyLabor.push({ ...line, dailyId: daily.id, project: daily.project }));
    (body.equipment || []).forEach(line => db.dailyEquipment.push({ ...line, dailyId: daily.id, project: daily.project }));
    (body.materials || []).forEach(line => db.dailyMaterials.push({ ...line, dailyId: daily.id, project: daily.project }));
    db.timeEntries = db.timeEntries || [];
    (body.labor || []).forEach((line, index) => {
      const id = `TE-${daily.id}-${String(index + 1).padStart(2, "0")}`;
      const timeRecord = {
        id,
        project: daily.project,
        employee: line.employee || submittedDaily.foreman || "Foreman",
        employeeId: line.employeeId || "",
        crew: submittedDaily.crew,
        date: submittedDaily.date,
        regularHours: Number(line.hours || 0),
        overtimeHours: 0,
        travelHours: 0,
        standbyHours: 0,
        foremanApproval: submittedDaily.foreman || "Foreman",
        approvalStatus: "Approved",
        payrollStatus: "Ready for export",
        jobCostStatus: "Posted",
        notes: `Created from submitted field daily ${daily.id}.`,
        activityLog: [],
        createdAt: new Date().toISOString(),
        modifiedAt: new Date().toISOString()
      };
      const timeIndex = db.timeEntries.findIndex(item => item.id === id);
      if (timeIndex === -1) db.timeEntries.push(timeRecord);
      else db.timeEntries[timeIndex] = { ...db.timeEntries[timeIndex], ...timeRecord };
    });

    db.formSubmissions = db.formSubmissions || [];
    db.documents = db.documents || [];
    db.photoEvidence = db.photoEvidence || [];
    const generatedAt = new Date().toISOString();
    const formTypes = [
      { type: "JSA", folder: "Safety / Form 12", billing: "No", safety: "Yes", status: "Submitted" },
      { type: "Daily Report", folder: "Dailies", billing: "Yes", safety: "No", status: "Submitted" },
      { type: "SOT", folder: "Invoice Support", billing: "Yes", safety: "No", status: "Submitted" },
      { type: "Photos", folder: "Photos", billing: "Yes", safety: "Yes", status: "Submitted" },
      { type: "As-built", folder: "As-builts", billing: "Yes", safety: "No", status: "Submitted" },
      { type: "Material Usage", folder: "Invoice Support", billing: "Yes", safety: "No", status: "Submitted" },
      { type: "Crew Time", folder: "Payroll / Job Cost", billing: "Yes", safety: "No", status: "Submitted" }
    ];
    formTypes.forEach(form => {
      const id = `FORM-${daily.id}-${form.type.replaceAll(" ", "-").toUpperCase()}`;
      const submission = {
        id,
        project: daily.project,
        dailyId: daily.id,
        type: form.type,
        submittedBy: daily.foreman || "Foreman",
        submittedAt: generatedAt,
        status: form.status,
        answers: {
          jsa: submittedDaily.jsa,
          inspections: submittedDaily.inspections,
          production: submittedDaily.production,
          laborHours: submittedDaily.laborHours,
          equipmentHours: submittedDaily.equipmentHours,
          materials: submittedDaily.materials
        },
        signatures: body.signatures || "Foreman and crew electronic signatures",
        attachments: body.attachments || "Generated from daily workflow",
        notes: `${form.type} generated from ${daily.id}`,
        activityLog: [],
        createdAt: generatedAt,
        modifiedAt: generatedAt
      };
      const formIndex = db.formSubmissions.findIndex(item => item.id === id);
      if (formIndex === -1) db.formSubmissions.push(submission);
      else db.formSubmissions[formIndex] = submission;

      const documentId = `DOC-${daily.id}-${form.type.replaceAll(" ", "-").toUpperCase()}`;
      const documentRecord = {
        id: documentId,
        project: daily.project,
        type: form.type,
        name: `${daily.id} ${form.type}`,
        status: form.status,
        path: `/documents/${daily.project}/generated/${documentId}.pdf`,
        folder: form.folder,
        author: daily.foreman || "Foreman",
        uploadedAt: generatedAt,
        requiredForBilling: form.billing,
        requiredForSafety: form.safety,
        fileType: "pdf",
        pinned: form.billing === "Yes" ? "Yes" : "No",
        notes: `${form.type} generated from field daily closeout and tied to billing package.`,
        activityLog: [],
        createdAt: generatedAt,
        modifiedAt: generatedAt
      };
      const docIndex = db.documents.findIndex(item => item.id === documentId);
      if (docIndex === -1) db.documents.push(documentRecord);
      else db.documents[docIndex] = documentRecord;
    });

    const photoId = `PHOTO-${daily.id}-PROGRESS`;
    if (!db.photoEvidence.some(item => item.id === photoId)) {
      db.photoEvidence.push({
        id: photoId,
        project: daily.project,
        linkedRecord: daily.id,
        workflowStage: "Field daily closeout",
        category: "Production / closeout evidence",
        caption: body.photoCaption || "Generated placeholder for field daily production, obstacle, and closeout photos.",
        imageUrl: "https://commons.wikimedia.org/wiki/Special:FilePath/Fiber_optic_cable_installation.jpg?width=640",
        sourceUrl: "https://commons.wikimedia.org/wiki/File:Fiber_optic_cable_installation.jpg",
        credit: "Wikimedia Commons",
        license: "Source placeholder",
        status: "Submitted",
        notes: "Photo evidence generated from field daily workflow placeholder.",
        activityLog: [],
        createdAt: generatedAt,
        modifiedAt: generatedAt
      });
    }

    db.qcCloseouts = db.qcCloseouts || [];
    const existingQc = db.qcCloseouts.find(item => item.project === daily.project);
    const productionSummary = (body.production || [])
      .map(line => `${Number(line.quantity || 0).toLocaleString()} ${line.unitCode || "units"}`)
      .join(", ") || submittedDaily.production || "Production submitted";
    const qcRecord = {
      ...(existingQc || {}),
      id: existingQc?.id || `QC-${daily.project}`,
      project: daily.project,
      segment: daily.project,
      workType: submittedDaily.scope || submittedDaily.production || "Field daily closeout",
      workmanship: existingQc?.workmanship && existingQc.workmanship !== "Pending review" ? existingQc.workmanship : "Pending review",
      reworkNeeded: existingQc?.reworkNeeded || "Unknown",
      chargebackRisk: existingQc?.chargebackRisk || "Unknown",
      photoRefs: existingQc?.photoRefs && existingQc.photoRefs !== "Generated field daily evidence" ? existingQc.photoRefs : photoId,
      status: existingQc?.status && existingQc.status !== "Missing" ? existingQc.status : "Pending Review",
      notes: `${existingQc?.notes ? `${existingQc.notes} | ` : ""}Daily ${daily.id} generated QC review packet with ${productionSummary}.`,
      activityLog: [
        ...(existingQc?.activityLog || []),
        {
          at: generatedAt,
          by: submittedDaily.foreman || "Foreman",
          note: `QC review packet opened from submitted field daily ${daily.id}.`
        }
      ],
      createdAt: existingQc?.createdAt || generatedAt,
      modifiedAt: generatedAt
    };
    if (existingQc) Object.assign(existingQc, qcRecord);
    else db.qcCloseouts.push(qcRecord);

    const projectRecord = db.projects.find(item => item.id === daily.project);
    if (projectRecord) {
      projectRecord.approvalLog = projectRecord.approvalLog || [];
      projectRecord.approvalLog.push({
        decision: "daily-evidence-generated",
        status: "Pending QC Review",
        by: submittedDaily.foreman || "Foreman",
        at: generatedAt,
        reason: `${daily.id} generated daily report, SOT, photo, material, crew time, as-built, and QC review evidence.`
      });
    }

    const project = recomputeProject(db, daily.project);
    const readiness = db.billingReadiness.find(item => item.project === daily.project);
    dispatchOperationalEvent(db, {
      eventName: "daily.submitted",
      transitionName: "daily.submitted",
      workflowType: "field-daily",
      aggregateType: "daily",
      aggregateId: daily.id,
      project: daily.project,
      fromStatus: previousDailyStatus,
      toStatus: submittedDaily.status,
      owner: submittedDaily.foreman || "Foreman",
      role: "Foreman",
      actor: submittedDaily.foreman || "Foreman",
      relatedRecords: [
        daily.id,
        qcRecord.id,
        ...(body.production || []).map(line => line.id).filter(Boolean),
        ...(body.labor || []).map((line, index) => `TE-${daily.id}-${String(index + 1).padStart(2, "0")}`)
      ],
      auditAction: "workflow.submitDaily",
      auditDetail: { dailyId: daily.id, project: daily.project, qc: qcRecord.id, by: submittedDaily.foreman || "Foreman" },
      payload: {
        productionLines: (body.production || []).length,
        laborLines: (body.labor || []).length,
        equipmentLines: (body.equipment || []).length,
        materialLines: (body.materials || []).length,
        qcOwner: "Operations",
        readinessStatus: readiness?.status || ""
      }
    }, { appendAudit });
    writeDb(db);
    return send(res, 200, { daily: submittedDaily, project, readiness });
  }

  if (req.method === "POST" && url.pathname === "/api/workflows/billing-package") {
    try {
      const body = await parseBody(req);
      const packageKey = body.packageKey || body.key;
      const action = body.action || "prepare";
      if (!packageKey) return send(res, 400, { error: "packageKey is required" });
      const actor = requestActor(req, "Billing");
      let result;
      if (action === "prepare") {
        result = createBillingPackageSnapshotServer(db, requireBillingPackageServer(db, packageKey), actor);
      } else if (action === "submit") {
        result = submitBillingPackageWorkflowServer(db, packageKey, body.details || {}, actor);
      } else if (action === "response" || action === "reject") {
        result = recordBillingPackageResponseServer(db, packageKey, { ...(body.details || {}), action }, actor);
      } else if (action === "payment" || action === "holdback" || action === "contractor-payment") {
        const type = action === "contractor-payment" ? "Contractor Package Payment" : action === "holdback" ? "SQUAN Holdback" : "SQUAN Package Payment";
        result = recordBillingPackagePaymentServer(db, packageKey, { type, ...(body.details || {}) }, actor);
      } else {
        return send(res, 400, { error: `Unsupported billing package workflow action: ${action}` });
      }
      writeDb(db);
      return send(res, 200, {
        ok: true,
        action,
        packageKey,
        workflowTransitions: (db.workflowTransitions || []).filter(item => item.packageKey === packageKey),
        ...result
      });
    } catch (error) {
      return send(res, error.statusCode || 500, {
        error: error.message || "Billing package workflow failed",
        blockers: error.blockers || []
      });
    }
  }

  if (req.method === "GET" && url.pathname === "/api/reports/executive") {
    return send(res, 200, summarize(db));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/audit-package") {
    return send(res, 200, {
      company: db.company,
      projects: db.projects,
      tasks: db.tasks || [],
      dailies: db.dailies,
      timeEntries: db.timeEntries || [],
      people: db.people,
      equipment: db.equipment,
      invoices: db.invoices,
      safety: db.safety,
      documents: db.documents,
      formSubmissions: db.formSubmissions || [],
      photoEvidence: db.photoEvidence || [],
      contractRules: db.contractRules || [],
      siteSurveys: db.siteSurveys || [],
      obstacles: db.obstacles || [],
      qcCloseouts: db.qcCloseouts || [],
      retainageLedger: db.retainageLedger || [],
      costBlockers: db.costBlockers || [],
      squanScores: db.squanScores || [],
      packetLocks: db.packetLocks || [],
      alertControls: db.alertControls || [],
      evidenceReviews: (db.projects || []).flatMap(project => (project.adminApprovals?.evidenceReviews || []).map(review => ({
        ...review,
        project: project.id,
        map: project.map || project.id,
        customer: project.customer || ""
      })))
    });
  }

  if (req.method === "GET" && url.pathname === "/api/reports/billing-package") {
    const projectId = url.searchParams.get("project");
    return send(res, 200, reportProjectPacket(db, projectId, "billing"));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/approved-production.csv") {
    return send(res, 200, csv(approvedProductionCsvRows(db), approvedProductionCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/ready-to-submit.csv") {
    return send(res, 200, csv(readyToSubmitCsvRows(db), billingPackageCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/billing-package-payments.csv") {
    return send(res, 200, csv(billingPackagePaymentCsvRows(db), billingPackagePaymentCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/billing-package-lifecycle.csv") {
    return send(res, 200, csv(billingPackageLifecycleCsvRows(db), billingPackageLifecycleCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/billing-package-exceptions.csv") {
    return send(res, 200, csv(billingPackageExceptionCsvRows(db), billingPackageExceptionCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/price-sheet-catalog.csv") {
    return send(res, 200, csv(priceSheetCatalogCsvRows(db), priceSheetCatalogCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/operational-cleanup.csv") {
    return send(res, 200, csv(operationalCleanupRowsServer(db), operationalCleanupCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/operational-readiness.csv") {
    return send(res, 200, csv(operationalReadinessCsvRowsServer(db), operationalReadinessCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/operational-closeout.csv") {
    return send(res, 200, csv(operationalCloseoutCsvRowsServer(db), operationalCloseoutCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/imported-submissions.csv") {
    return send(res, 200, csv(importedSubmissionRowsServer(db), importedSubmissionCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/resubmission-comparison.csv") {
    return send(res, 200, csv(resubmissionComparisonRowsServer(db), resubmissionComparisonCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/demo-archive.csv") {
    return send(res, 200, csv(demoArchiveRowsServer(db), demoArchiveCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/billing-package.csv") {
    const projectId = url.searchParams.get("project") || "";
    const workedDate = url.searchParams.get("workedDate") || "";
    const code = url.searchParams.get("code") || "";
    const key = url.searchParams.get("key") || "";
    const packages = billingPackageWorkflowRowsServer(db).filter(pack => {
      if (key) return pack.key === key;
      return (!projectId || pack.projectId === projectId)
        && (!workedDate || pack.workedDate === workedDate)
        && (!code || pack.code === code);
    });
    return send(res, 200, csv(billingPackageCsvRows(packages, db), billingPackageCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/squan-tracker-record.csv") {
    const projectId = url.searchParams.get("project") || "";
    const workedDate = url.searchParams.get("workedDate") || "";
    const code = url.searchParams.get("code") || "";
    const key = url.searchParams.get("key") || "";
    const packages = billingPackageWorkflowRowsServer(db).filter(pack => {
      if (key) return pack.key === key;
      return (!projectId || pack.projectId === projectId)
        && (!workedDate || pack.workedDate === workedDate)
        && (!code || pack.code === code)
        && ["Ready to Submit", "Submitted to SQUAN", "Approved by SQUAN", "Partially approved by SQUAN", "Paid / holdback", "Closed"].includes(pack.status);
    });
    return send(res, 200, csv(squanTrackerRecordCsvRows(packages, db), squanTrackerRecordCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/contractor-settlements.csv") {
    return send(res, 200, csv(contractorSettlementRowsServer(db), contractorSettlementCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/contractor-agreements.csv") {
    return send(res, 200, csv(contractorAgreementCsvRows(db), contractorAgreementCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/contractor-deductions.csv") {
    return send(res, 200, csv(contractorDeductionCsvRows(db), contractorDeductionCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/contractor-unpaid.csv") {
    return send(res, 200, csv(contractorSettlementRowsServer(db).filter(row => Number(row.balance || 0) > 0), contractorSettlementCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/contractor-holdbacks.csv") {
    const holdbackPackages = new Set((db.cashReceipts || []).filter(item => item.type === "SQUAN Holdback").map(item => item.packageKey));
    return send(res, 200, csv(contractorSettlementRowsServer(db).filter(row => holdbackPackages.has(row.packageKey) || row.status === "Disputed"), contractorSettlementCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/contractor-disputed.csv") {
    return send(res, 200, csv(contractorSettlementRowsServer(db).filter(row => row.status === "Disputed"), contractorSettlementCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/contractor-settlement-payments.csv") {
    return send(res, 200, csv(contractorSettlementPaymentCsvRows(db), contractorSettlementPaymentCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/contractor-settlement-statement.csv") {
    const settlement = url.searchParams.get("settlement") || "";
    return send(res, 200, csv(contractorSettlementRowsServer(db).filter(row => !settlement || row.settlementId === settlement), contractorSettlementCsvHeaders), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/daily-package-intake") {
    return send(res, 200, dailyPackageReport(db, url.searchParams.get("project") || ""));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/daily-package-intake.csv") {
    const report = dailyPackageReport(db, url.searchParams.get("project") || "");
    return send(res, 200, csv(dailyPackageCsvRows(report)), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/completed-forms") {
    return send(res, 200, completedFormsReport(db, url.searchParams.get("project") || ""));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/completed-forms.csv") {
    const report = completedFormsReport(db, url.searchParams.get("project") || "");
    return send(res, 200, csv(completedFormsCsvRows(report)), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/daily-package-sla") {
    return send(res, 200, dailyPackageSlaReport(db, url.searchParams.get("project") || ""));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/daily-package-sla.csv") {
    const report = dailyPackageSlaReport(db, url.searchParams.get("project") || "");
    return send(res, 200, csv(dailyPackageSlaCsvRows(report)), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/billing-task-closeouts") {
    return send(res, 200, reportBillingTaskCloseouts(db, url.searchParams.get("project") || ""));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/billing-task-closeouts.csv") {
    const report = reportBillingTaskCloseouts(db, url.searchParams.get("project") || "");
    return send(res, 200, csv(billingTaskCloseoutCsvRows(report)), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/financial-closeouts") {
    return send(res, 200, reportFinancialCloseouts(db, url.searchParams.get("project") || ""));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/financial-closeouts.csv") {
    const report = reportFinancialCloseouts(db, url.searchParams.get("project") || "");
    return send(res, 200, csv(financialCloseoutCsvRows(report)), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/closeout-readiness-breaches") {
    return send(res, 200, reportCloseoutReadinessBreaches(db, url.searchParams.get("project") || ""));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/closeout-readiness-breaches.csv") {
    const report = reportCloseoutReadinessBreaches(db, url.searchParams.get("project") || "");
    return send(res, 200, csv(closeoutReadinessBreachCsvRows(report)), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/closeout-package") {
    const projectId = url.searchParams.get("project");
    return send(res, 200, reportProjectPacket(db, projectId, "closeout"));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/exception-report") {
    const projectId = url.searchParams.get("project");
    return send(res, 200, reportExceptionPacket(db, projectId));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/field-capture-audit") {
    return send(res, 200, reportFieldCaptureAudit(db, url.searchParams.get("project") || ""));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/field-capture-audit.csv") {
    const report = reportFieldCaptureAudit(db, url.searchParams.get("project") || "");
    return send(res, 200, csv(fieldCaptureAuditCsvRows(report)), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/packet-locks") {
    return send(res, 200, reportPacketLocks(db, {
      projectId: url.searchParams.get("project") || "",
      scope: url.searchParams.get("scope") || ""
    }));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/packet-locks.csv") {
    const report = reportPacketLocks(db, {
      projectId: url.searchParams.get("project") || "",
      scope: url.searchParams.get("scope") || ""
    });
    return send(res, 200, csv(packetLockCsvRows(report)), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/cash-forecast") {
    return send(res, 200, reportCashForecast(db, url.searchParams.get("scenario") || "baseline"));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/cash-forecast.csv") {
    const report = reportCashForecast(db, url.searchParams.get("scenario") || "baseline");
    return send(res, 200, csv(cashForecastCsvRows(report)), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/deposit-batches") {
    return send(res, 200, {
      company: db.company,
      generatedAt: new Date().toISOString(),
      batches: cashDepositBatchRows(db),
      receipts: cashReconciliationRows(db)
    });
  }

  if (req.method === "GET" && url.pathname === "/api/reports/deposit-batches.csv") {
    const report = {
      company: db.company,
      generatedAt: new Date().toISOString(),
      batches: cashDepositBatchRows(db),
      receipts: cashReconciliationRows(db)
    };
    return send(res, 200, csv(depositBatchCsvRows(report)), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/ar-aging") {
    return send(res, 200, arAgingReport(db));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/ar-aging.csv") {
    return send(res, 200, csv(arAgingCsvRows(arAgingReport(db))), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/collections-packet") {
    return send(res, 200, reportCollectionsPacket(db));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/collections-packet.csv") {
    return send(res, 200, csv(collectionsPacketCsvRows(reportCollectionsPacket(db))), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/collections-decisions") {
    return send(res, 200, reportCollectionsDecisions(db));
  }

  if (req.method === "GET" && url.pathname === "/api/reports/collections-decisions.csv") {
    return send(res, 200, csv(collectionsDecisionCsvRows(reportCollectionsDecisions(db))), "text/csv; charset=utf-8");
  }

  if (req.method === "GET" && url.pathname === "/api/reports/ar-retainage") {
    return send(res, 200, {
      company: db.company,
      invoices: db.invoices || [],
      invoiceSubmissions: db.invoiceSubmissions || [],
      retainageLedger: db.retainageLedger || [],
      generatedAt: new Date().toISOString()
    });
  }

  if (req.method === "GET" && url.pathname === "/api/reports/compliance") {
    return send(res, 200, {
      company: db.company,
      people: db.people || [],
      equipment: db.equipment || [],
      projects: db.projects || [],
      tasks: (db.tasks || []).filter(task => ["People & Compliance", "Equipment"].includes(task.workflowArea)),
      generatedAt: new Date().toISOString()
    });
  }

  if (req.method === "GET" && parts[0] === "api" && parts[1] === "exports" && collections.has(parts[2])) {
    if (req.user.role !== "Admin") return send(res, 403, { error: "Forbidden" });
    return send(res, 200, csv(db[parts[2]]), "text/csv; charset=utf-8");
  }

  if (parts[0] === "api" && collections.has(parts[1])) {
    const collection = parts[1];
    const id = decodeURIComponent(parts[2] || "");
    db[collection] = db[collection] || [];
    if (!canAccessCollection(req.user, collection, req.method)) return send(res, 403, { error: "Forbidden" });

    if (req.method === "GET") {
      if (!id) return send(res, 200, db[collection]);
      const record = db[collection].find(item => item.id === id);
      return record ? send(res, 200, record) : send(res, 404, { error: "Record not found" });
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      if (!body.id) body.id = `${collection.toUpperCase()}-${Date.now()}`;
      if (db[collection].some(item => item.id === body.id)) return send(res, 409, { error: "Duplicate record id" });
      body.createdAt = body.createdAt || new Date().toISOString();
      body.modifiedAt = new Date().toISOString();
      db[collection].push(body);
      appendAudit(db, `${collection}.create`, { id: body.id, by: requestActor(req), ...auditContext(req) });
      writeDb(db);
      return send(res, 201, body);
    }

    if (req.method === "PUT" && id) {
      const body = await parseBody(req);
      const index = db[collection].findIndex(item => item.id === id);
      if (index === -1) return send(res, 404, { error: "Record not found" });
      const before = beforeSnapshot(collection, db[collection][index]);
      db[collection][index] = { ...body, id, modifiedAt: new Date().toISOString() };
      appendAudit(db, `${collection}.update`, { id, by: requestActor(req), before, after: before ? beforeSnapshot(collection, db[collection][index]) : undefined, ...auditContext(req) });
      writeDb(db);
      return send(res, 200, db[collection][index]);
    }

    if (req.method === "DELETE" && id) {
      const index = db[collection].findIndex(item => item.id === id);
      if (index === -1) return send(res, 404, { error: "Record not found" });
      const reason = protectedDeleteReason(collection, db[collection][index]);
      if (reason) return send(res, 409, { error: reason });
      const [deleted] = db[collection].splice(index, 1);
      appendAudit(db, `${collection}.delete`, { id, by: requestActor(req), before: beforeSnapshot(collection, deleted), ...auditContext(req) });
      writeDb(db);
      return send(res, 200, deleted);
    }
  }

  return send(res, 404, { error: "API route not found" });
}

function serveFile(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  if (!canServePublicPath(requested)) return send(res, 404, "Not found", "text/plain; charset=utf-8");
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  fs.readFile(filePath, (error, content) => {
    if (error) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    send(res, 200, content, publicContentType(filePath));
  });
}

const server = http.createServer(async (req, res) => {
  const startedAt = Date.now();
  req.requestId = requestId(req);
  res.setHeader("X-Request-ID", req.requestId);
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (PRODUCTION_MODE && !ALLOW_INSECURE_HTTP && req.headers["x-forwarded-proto"] !== "https") {
      return send(res, 426, { error: "HTTPS is required" });
    }
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveFile(req, res, url);
    }
  } catch (error) {
    logEvent("error", "request.error", { requestId: req.requestId, method: req.method, path: url.pathname, error: error.message, stack: DEBUG_ERRORS ? error.stack : undefined });
    send(res, 500, { error: DEBUG_ERRORS ? error.message : "Internal server error" });
  } finally {
    res.once("finish", () => {
      logEvent(res.statusCode >= 500 ? "error" : "info", "request.complete", {
        requestId: req.requestId,
        method: req.method,
        path: url.pathname,
        status: res.statusCode,
        durationMs: Date.now() - startedAt,
        userId: req.user?.id || "",
        role: req.user?.role || "",
        ip: clientIp(req)
      });
    });
  }
});

server.on("error", error => {
  if (error.code === "EADDRINUSE") {
    console.error(`Port ${PORT} is already in use.`);
    console.error("Run `npm run server:status` to see SyncERP listeners.");
    console.error("Run `npm run server:dedupe` to keep the canonical server and stop duplicates.");
    process.exit(1);
  }
  throw error;
});

try {
  enforceProductionConfig();
  server.listen(PORT, () => {
    console.log(`Jackson Telcom ERP running at http://127.0.0.1:${PORT}`);
  });
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function shutdown(signal) {
  logEvent("info", "server.shutdown", { signal });
  server.close(error => {
    if (error) {
      logEvent("error", "server.shutdown_error", { error: error.message });
      process.exit(1);
    }
    process.exit(0);
  });
  setTimeout(() => {
    logEvent("error", "server.shutdown_timeout", { signal });
    process.exit(1);
  }, 10000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
