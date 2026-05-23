const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");
const startPort = Number(process.env.WORKFLOW_INTEGRATION_PORT || 8343);

function findOpenPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", error => {
      if (error.code === "EADDRINUSE") return findOpenPort(port + 1).then(resolve, reject);
      reject(error);
    });
    server.once("listening", () => server.close(() => resolve(port)));
    server.listen(port, "127.0.0.1");
  });
}

function request(baseUrl, pathname, options = {}) {
  return new Promise((resolve, reject) => {
    const body = options.body ? JSON.stringify(options.body) : "";
    const req = http.request(`${baseUrl}${pathname}`, {
      method: options.method || "GET",
      headers: {
        ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {})
      }
    }, res => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        text += chunk;
      });
      res.on("end", () => resolve({ status: res.statusCode, text }));
    });
    req.setTimeout(5000, () => req.destroy(new Error(`${pathname} timed out`)));
    req.on("error", reject);
    req.end(body);
  });
}

async function waitForServer(baseUrl) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const response = await request(baseUrl, "/api/health");
      if (response.status === 200) return;
    } catch (error) {
      // retry
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Workflow integration test server did not start");
}

async function loginAs(baseUrl, email, password = "demo") {
  const response = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { email, password }
  });
  assert.strictEqual(response.status, 200, `login failed for ${email}: ${response.text}`);
  return JSON.parse(response.text).token;
}

function seedWorkflowRow(db) {
  const now = new Date().toISOString();
  db.workflowTransitions = [];
  db.projects = db.projects || [];
  db.productionDailies = db.productionDailies || [];
  db.productionLines = db.productionLines || [];
  db.billingLedger = db.billingLedger || [];
  db.fieldEvidence = db.fieldEvidence || [];
  db.priceSheetItems = db.priceSheetItems || [];
  db.auditLog = db.auditLog || [];
  db.cashReceipts = db.cashReceipts || [];
  db.packageSnapshots = [];
  db.invoiceSubmissions = [];
  db.invoices = [];
  db.projects.push({
    id: "WF-PROJ-1",
    map: "WF-PROJ-1",
    customer: "SQUAN",
    status: "Active",
    billBy: "2026-06-01",
    createdAt: now,
    modifiedAt: now
  });
  db.priceSheetItems.push({
    id: "PRICE-WF-A100",
    code: "WF-A100",
    unitName: "Workflow Test Unit",
    uom: "EA",
    subRate: 50,
    source: "Workflow integration test",
    status: "Active",
    createdAt: now,
    modifiedAt: now
  });
  db.productionDailies.push({
    id: "PD-WF-1",
    externalDailyId: "DAILY-WF-1",
    project: "WF-PROJ-1",
    workedDate: "2026-05-20",
    submittedBy: "Workflow Contractor",
    status: "Accepted",
    createdAt: now,
    modifiedAt: now
  });
  db.productionLines.push({
    id: "PL-WF-1",
    dailyId: "PD-WF-1",
    project: "WF-PROJ-1",
    ntp: "WF-PROJ-1",
    workedDate: "2026-05-20",
    submittedBy: "Workflow Contractor",
    code: "WF-A100",
    unitName: "Workflow Test Unit",
    quantity: 2,
    uom: "EA",
    unitRate: 50,
    submittedAmount: 100,
    reviewStatus: "Accepted",
    proofStatus: "Accepted",
    billableStatus: "Ready to Bill",
    payableStatus: "Job Cost",
    createdAt: now,
    modifiedAt: now
  });
  db.fieldEvidence.push({
    id: "FE-WF-1",
    project: "WF-PROJ-1",
    dailyId: "PD-WF-1",
    productionLineId: "PL-WF-1",
    status: "Accepted",
    createdAt: now,
    modifiedAt: now
  });
  db.billingLedger.push({
    id: "BILL-PL-WF-1",
    productionLineId: "PL-WF-1",
    project: "WF-PROJ-1",
    workedDate: "2026-05-20",
    code: "WF-A100",
    quantity: 2,
    squanBillableAmount: 100,
    contractorPayableAmount: 0,
    inHouseCostAmount: 100,
    proofStatus: "Accepted",
    paymentStatus: "Open",
    billingStatus: "Ready to Bill",
    createdAt: now,
    modifiedAt: now
  });
}

async function workflowAction(baseUrl, token, action, details = {}) {
  const response = await request(baseUrl, "/api/workflows/billing-package", {
    method: "POST",
    token,
    body: {
      packageKey: "WF-PROJ-1|2026-05-20|WF-A100",
      action,
      details
    }
  });
  assert.strictEqual(response.status, 200, `${action} failed: ${response.text}`);
  return JSON.parse(response.text);
}

async function run() {
  const port = await findOpenPort(startPort);
  const baseUrl = `http://127.0.0.1:${port}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "syncerp-workflow-qa-"));
  const tempDbPath = path.join(tempDir, "db.json");
  const db = JSON.parse(fs.readFileSync(path.join(root, "data", "db.json"), "utf8"));
  seedWorkflowRow(db);
  fs.writeFileSync(tempDbPath, `${JSON.stringify(db, null, 2)}\n`);

  const server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DRIVER: "json", DEMO_AUTH: "true", DB_PATH: tempDbPath },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const output = [];
  server.stdout.on("data", chunk => output.push(String(chunk).trim()));
  server.stderr.on("data", chunk => output.push(String(chunk).trim()));

  try {
    await waitForServer(baseUrl);
    const billingToken = await loginAs(baseUrl, "billing@jacksontelcom.example");

    const prepared = await workflowAction(baseUrl, billingToken, "prepare");
    assert.strictEqual(prepared.snapshot.status, "Ready to Submit");
    assert.strictEqual(prepared.invoice.status, "Ready to Submit");
    assert(prepared.snapshot.productionLineIds.includes("PL-WF-1"), "snapshot should link production line");
    assert(prepared.snapshot.billingLedgerIds.includes("BILL-PL-WF-1"), "snapshot should link billing ledger");

    const submitted = await workflowAction(baseUrl, billingToken, "submit", {
      confirmationNumber: "SQUAN-WF-100",
      contact: "SQUAN AP",
      method: "Manual SQUAN Tracker entry",
      submissionDate: "2026-05-21",
      packageValue: 100
    });
    assert.strictEqual(submitted.submission.status, "Submitted to SQUAN");
    assert.strictEqual(submitted.snapshot.locked, "Yes");

    const response = await workflowAction(baseUrl, billingToken, "response", {
      status: "Approved by SQUAN",
      approvedAmount: 100,
      note: "Approved in workflow integration test."
    });
    assert.strictEqual(response.submission.status, "Approved by SQUAN");
    assert.strictEqual(response.snapshot.approvedAmount, 100);

    const payment = await workflowAction(baseUrl, billingToken, "payment", {
      actualAmount: 100,
      actualDate: "2026-05-25",
      reference: "DEP-WF-100",
      bankProof: "Bank proof attached"
    });
    assert.strictEqual(payment.receipt.type, "SQUAN Package Payment");
    assert.strictEqual(payment.invoice.status, "Paid");
    assert.strictEqual(payment.submission.status, "Paid by SQUAN");

    const finalDb = JSON.parse(fs.readFileSync(tempDbPath, "utf8"));
    const transitions = finalDb.workflowTransitions.filter(item => item.packageKey === "WF-PROJ-1|2026-05-20|WF-A100");
    assert.deepStrictEqual(transitions.map(item => item.transition), [
      "billing.package.prepare",
      "billing.package.submit",
      "billing.package.response",
      "billing.package.squan-payment"
    ]);
    assert(finalDb.auditLog.some(item => item.action === "billing.package.squan-payment.server"), "payment audit event should be recorded");

    console.log("Workflow integration test passed");
  } finally {
    server.kill("SIGTERM");
    await new Promise(resolve => server.once("exit", resolve));
    fs.rmSync(tempDir, { recursive: true, force: true });
    if (output.some(line => /Error|Unhandled|EADDRINUSE/.test(line))) {
      console.error(output.join("\n"));
    }
  }
}

run().catch(error => {
  console.error(error);
  process.exit(1);
});
