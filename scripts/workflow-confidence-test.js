const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");
const startPort = Number(process.env.WORKFLOW_QA_PORT || 8123);

function findOpenPort(port) {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", error => {
      if (error.code === "EADDRINUSE") {
        findOpenPort(port + 1).then(resolve, reject);
        return;
      }
      reject(error);
    });
    server.once("listening", () => {
      server.close(() => resolve(port));
    });
    server.listen(port, "127.0.0.1");
  });
}

function getText(baseUrl, pathname, token = "") {
  return new Promise((resolve, reject) => {
    const options = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    const req = http.get(`${baseUrl}${pathname}`, options, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${pathname} returned HTTP ${res.statusCode}`));
          return;
        }
        resolve(body);
      });
    });
    req.setTimeout(5000, () => {
      req.destroy(new Error(`${pathname} timed out`));
    });
    req.on("error", reject);
  });
}

function postJson(baseUrl, pathname, body, token = "") {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const req = http.request(`${baseUrl}${pathname}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(text),
        ...(token ? { Authorization: `Bearer ${token}` } : {})
      }
    }, res => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        responseBody += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${pathname} returned HTTP ${res.statusCode}: ${responseBody}`));
          return;
        }
        resolve(JSON.parse(responseBody || "{}"));
      });
    });
    req.setTimeout(5000, () => {
      req.destroy(new Error(`${pathname} timed out`));
    });
    req.on("error", reject);
    req.end(text);
  });
}

async function waitForServer(baseUrl, timeoutMs = 10000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      await getText(baseUrl, "/");
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  throw lastError || new Error("Server did not start");
}

function assertIncludes(label, text, token) {
  if (!text.includes(token)) {
    throw new Error(`${label} missing token: ${token}`);
  }
}

function firstCsvLine(text) {
  return String(text || "").split(/\r?\n/).find(Boolean) || "";
}

function uniqueValues(values) {
  return [...new Set(values)].sort();
}

function assertPriceSheetImport() {
  const data = JSON.parse(fs.readFileSync(path.join(root, "data/db.json"), "utf8"));
  const rows = data.priceSheetItems || [];
  const byCode = new Map(rows.map(row => [row.code, row]));
  const importedRows = rows.filter(row => row.sourceType === "SQUAN / Brightspeed prime sheet");
  const requiredRates = [
    ["BSMI-001", 0.63],
    ["BSMI-003", 1.05],
    ["BSMI-015", 29.05],
    ["WC-1", 67.5],
    ["DL-RL", 0.5],
    ["BSPDDBIR", 40],
    ["BSPDSPLTPA", 260],
    ["BRSPDPLOWADD", 1]
  ];
  if (rows.length < 128) {
    throw new Error(`Price sheet import is incomplete: expected at least 128 rows, found ${rows.length}`);
  }
  if (importedRows.length < 128) {
    throw new Error(`SQUAN / Brightspeed prime sheet import is incomplete: expected at least 128 rows, found ${importedRows.length}`);
  }
  for (const [code, expectedRate] of requiredRates) {
    const row = byCode.get(code);
    if (!row) throw new Error(`Price sheet missing required code ${code}`);
    const actualRate = Number(row.subRate || 0);
    if (Math.abs(actualRate - expectedRate) > 0.001) {
      throw new Error(`Price sheet code ${code} expected rate ${expectedRate}, found ${actualRate}`);
    }
  }
  for (const code of ["TS01", "HRS"]) {
    if (!byCode.has(code)) throw new Error(`Local/prior-approval price code ${code} was not preserved`);
  }
}

async function run() {
  assertPriceSheetImport();

  const port = await findOpenPort(startPort);
  const baseUrl = `http://127.0.0.1:${port}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "syncerp-workflow-qa-"));
  const tempDbPath = path.join(tempDir, "db.json");
  fs.copyFileSync(path.join(root, "data", "db.json"), tempDbPath);
  const server = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(port), DATA_DRIVER: "json", DEMO_AUTH: "true", DB_PATH: tempDbPath },
    stdio: ["ignore", "pipe", "pipe"]
  });

  const serverOutput = [];
  server.stdout.on("data", chunk => serverOutput.push(String(chunk).trim()));
  server.stderr.on("data", chunk => serverOutput.push(String(chunk).trim()));

  try {
    await waitForServer(baseUrl);
    const login = await postJson(baseUrl, "/api/auth/login", {
      email: "ronald@jacksontelcom.example",
      password: "demo"
    });
    const token = login.token;

    const [indexHtml, appSource, styles] = await Promise.all([
      getText(baseUrl, "/"),
      getText(baseUrl, "/src/app.js"),
      getText(baseUrl, "/src/styles.css")
    ]);
    const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");

    const appTokens = [
      ["App shell", indexHtml, "id=\"app\""],
      ["Daily Capture tab", appSource, "data-production-mode"],
      ["Daily Capture Submit Daily mode", appSource, "Submit Daily"],
      ["Daily Capture Review mode", appSource, "Review"],
      ["Daily Capture Billing Handoff mode", appSource, "Billing Handoff"],
      ["Daily Capture Reports mode", appSource, "Reports & Tools"],
      ["Daily Capture route mapping", appSource, "productionModeForWorkflow"],
      ["Reports route mapping", appSource, "reportModeForWorkflow"],
      ["Foreman submit handler", appSource, "handleProductionDailySubmit"],
      ["Foreman draft save handler", appSource, "handleProductionDailyDraftSave"],
      ["Foreman submit readiness", appSource, "renderForemanSubmitReadiness"],
      ["Foreman required field checklist", appSource, "data-production-submit-readiness"],
      ["Admin review handler", appSource, "handleProductionReview"],
      ["Admin status board", appSource, "renderProductionAdminStatusBoard"],
      ["Admin status buckets", appSource, "productionAdminStatusBuckets"],
      ["Admin Draft lane", appSource, "Draft"],
      ["Admin Submitted lane", appSource, "Submitted"],
      ["Admin Needs Proof lane", appSource, "Needs Proof"],
      ["Admin Needs Review lane", appSource, "Needs Review"],
      ["Admin Approved lane", appSource, "Approved"],
      ["Admin Billing Ready lane", appSource, "Billing Ready"],
      ["Proof action handler", appSource, "handleProductionProofAction"],
      ["Billing handoff summary", appSource, "renderProductionBillingHandoffSummary"],
      ["Billing rate validation", appSource, "Billing code rate is missing"],
      ["Billing rate review task", appSource, "createProductionRateReviewTask"],
      ["Billing package detail", appSource, "renderBillingPackageDetailView"],
      ["Billing package preview", appSource, "renderBillingPackagePreview"],
      ["Billing package export filename", appSource, "billingPackageExportFileName"],
      ["SQUAN submission drawer", appSource, "openBillingPackageSubmissionDrawer"],
      ["SQUAN submitted date", appSource, "submissionDate"],
      ["SQUAN package value", appSource, "packageValue"],
      ["SQUAN submission form", appSource, "billingPackageSubmissionForm"],
      ["SQUAN response drawer", appSource, "openBillingPackageResponseDrawer"],
      ["SQUAN partial approval", appSource, "Partially approved by SQUAN"],
      ["SQUAN approval variance", appSource, "responseVariance"],
      ["SQUAN response form", appSource, "billingPackageResponseForm"],
      ["Package payment drawer", appSource, "openBillingPackagePaymentDrawer"],
      ["Package payment form", appSource, "billingPackagePaymentForm"],
      ["Package lifecycle lanes", appSource, "data-billing-package-lifecycle-lanes"],
      ["Submit today dashboard", appSource, "renderBillingSubmitTodayDashboard"],
      ["Package duplicate protection", appSource, "billingPackageDuplicateRisk"],
      ["Package readiness score", appSource, "billingPackageReadinessScore"],
      ["Correction package flow", appSource, "createSquanCorrectionPackage"],
      ["Submitted line snapshots", appSource, "submittedLineSnapshots"],
      ["Ready to package lane", appSource, "Ready to package"],
      ["Paid holdback lane", appSource, "Paid / holdback"],
      ["Contractor open lane", appSource, "Contractor open"],
      ["Package action readiness", appSource, "renderBillingPackageActionReadiness"],
      ["Submit to SQUAN action", appSource, "submit-squan"],
      ["SQUAN payment action", appSource, "record-squan-package-payment"],
      ["SQUAN holdback action", appSource, "record-squan-holdback"],
      ["Contractor payment action", appSource, "record-contractor-package-payment"],
      ["Contractor settlement workbench", appSource, "renderContractorSettlementWorkbench"],
      ["Contractor agreement versioning", appSource, "agreementForContractor"],
      ["Contractor agreement manager", appSource, "renderAgreementManager"],
      ["Contractor agreement drawer", appSource, "openAgreementDrawer"],
      ["Settlement detail panel", appSource, "renderSettlementDetail"],
      ["Settlement issue validation", appSource, "settlementIssueValidation"],
      ["Settlement deduction drawer", appSource, "openSettlementDeductionDrawer"],
      ["Settlement deduction edit drawer", appSource, "openSettlementDeductionEditDrawer"],
      ["Settlement payment drawer", appSource, "openSettlementPaymentDrawer"],
      ["Settlement action handler", appSource, "handleSettlementAction"],
      ["Settlement rate permission", appSource, "settlement.rate.view"],
      ["Real data source classifier", appSource, "function dataSourceMode"],
      ["Real source classification", appSource, "function dataSourceClassification"],
      ["Real submission preservation panel", appSource, "renderRealSubmissionPreservationPanel"],
      ["Real imported submission rows", appSource, "realSubmissionRows"],
      ["Resubmission comparison rows", appSource, "resubmissionComparisonRows"],
      ["Demo archive rows", appSource, "demoArchiveRows"],
      ["Real submission action handler", appSource, "handleRealSubmissionAction"],
      ["Imported submissions export", serverSource, "/api/reports/imported-submissions.csv"],
      ["Resubmission comparison export", serverSource, "/api/reports/resubmission-comparison.csv"],
      ["Demo archive export", serverSource, "/api/reports/demo-archive.csv"],
      ["Operational data readiness gate", appSource, "function operationalDataReadiness"],
      ["Data mode warning banner", appSource, "function renderDataModeBanner"],
      ["Data readiness dashboard", appSource, "function renderDataReadinessDashboard"],
      ["Data readiness marker", appSource, "data-data-readiness-dashboard"],
      ["Operational completion panel", appSource, "renderOperationalCompletionPanel"],
      ["Operational completion checklist", appSource, "operationalCompletionChecklist"],
      ["Operational closeout checklist", appSource, "operationalCloseoutChecklist"],
      ["Operational closeout panel", appSource, "renderOperationalCloseoutPanel"],
      ["Required field matrix", appSource, "operationalRequiredFieldMatrix"],
      ["Record locking rules", appSource, "operationalRecordLockRules"],
      ["Exception paths", appSource, "operationalExceptionPaths"],
      ["Operational closeout export", serverSource, "/api/reports/operational-closeout.csv"],
      ["Operational cleanup queue", appSource, "renderOperationalCleanupQueue"],
      ["Operational cleanup task action", appSource, "data-operational-cleanup-task"],
      ["Go-live mode save", appSource, "saveGoLiveMode"],
      ["Server backup control", appSource, "downloadServerBackup"],
      ["Restore backup control", appSource, "restoreBackupFromFile"],
      ["MAMP MySQL note", appSource, "MAMP MySQL migration next"],
      ["Server backup endpoint", serverSource, "/api/admin/backup"],
      ["Restore validation endpoint", serverSource, "/api/admin/restore/validate"],
      ["Go-live mode endpoint", serverSource, "/api/admin/go-live-mode"],
      ["Protected delete guard", serverSource, "protectedDeleteReason"],
      ["Drawer styles", styles, "billing-package-drawer"],
      ["Package preview styles", styles, "billing-package-preview"],
      ["Readiness styles", styles, "billing-package-readiness"],
      ["Foreman readiness styles", styles, "foreman-submit-readiness"],
      ["Admin status styles", styles, "production-admin-status-board"],
      ["Daily Capture styles", styles, "production-mode-tab"],
      ["Data mode banner styles", styles, "data-mode-banner"],
      ["Data readiness dashboard styles", styles, "data-readiness-dashboard"],
      ["Operational completion styles", styles, "operational-completion-panel"],
      ["Operational cleanup styles", styles, "operational-cleanup-queue"]
    ];

    for (const [label, text, token] of appTokens) {
      assertIncludes(label, text, token);
    }

    const productionAttrs = uniqueValues([...appSource.matchAll(/data-([a-z0-9-]+)(?:=|\])/gi)]
      .map(match => match[1])
      .filter(attr => attr.startsWith("production") || attr.startsWith("squan-feature") || attr.startsWith("map-feature")));
    const handledAttrs = new Set([...appSource.matchAll(/querySelectorAll\("\[data-([a-z0-9-]+)\]/g)].map(match => match[1]));
    const passiveAttrs = new Set([
      "production-id",
      "production-mode-panel",
      "production-submit-readiness",
      "squan-feature-id"
    ]);
    const unhandledAttrs = productionAttrs.filter(attr => !handledAttrs.has(attr) && !passiveAttrs.has(attr));
    if (unhandledAttrs.length) {
      throw new Error(`Unhandled Daily Capture action attributes: ${unhandledAttrs.map(attr => `data-${attr}`).join(", ")}`);
    }

    const billingAttrs = uniqueValues([...appSource.matchAll(/data-([a-z0-9-]+)(?:=|\])/gi)]
      .map(match => match[1])
      .filter(attr => attr.startsWith("billing")));
    const passiveBillingAttrs = new Set([
      "billing-package-key"
    ]);
    const unhandledBillingAttrs = billingAttrs.filter(attr => !handledAttrs.has(attr) && !passiveBillingAttrs.has(attr));
    if (unhandledBillingAttrs.length) {
      throw new Error(`Unhandled Billing action attributes: ${unhandledBillingAttrs.map(attr => `data-${attr}`).join(", ")}`);
    }

    const routeTokens = [
      ["Role nav order", appSource, "const roleNavOrder"],
      ["Role nav resolver", appSource, "function navigationForRole"],
      ["Role home profile", appSource, "function roleHomeProfile"],
      ["Simple role home", appSource, "function renderSimpleRoleHome"],
      ["Foreman home", appSource, "function renderForemanHome"],
      ["Operational role dashboard", appSource, "function renderOperationalRoleDashboard"],
      ["Operational role work items", appSource, "function operationalRoleWorkItems"],
      ["Operational queue marker", appSource, "data-operational-work-queue"],
      ["Operational dashboard styles", styles, "operational-work-card"],
      ["Operations board", appSource, "function renderOperationsBoard"],
      ["Safety queue", appSource, "function renderSafetyRiskQueue"],
      ["View navigation", appSource, "function navigateToView"],
      ["View renderer", appSource, "function renderView"],
      ["Workflow target", appSource, "function workflowTarget"],
      ["Workflow route config", appSource, "function configureWorkflowRoute"],
      ["Workflow rail route", appSource, "function routeWorkflowRailElement"],
      ["Workflow click handler", appSource, "function handleWorkflowClick"],
      ["Project metadata click guard", appSource, "function isProjectNavigationOnly"],
      ["Project navigation guard use", appSource, "if (!isProjectNavigationOnly(button)) return;"],
      ["Daily Capture route mode", appSource, "productionModeForWorkflow"],
      ["Reports route mode", appSource, "reportModeForWorkflow"],
      ["Foreman submit route", appSource, "Submit Daily"],
      ["Admin Daily Capture visibility", appSource, "Admin visibility"],
      ["Admin owner decisions", appSource, "Owner decisions today"],
      ["Review Queue route label", appSource, "Review Queue"],
      ["Billing package lifecycle route", appSource, "Ready to package"],
      ["Billing ownership route", appSource, "Billing ownership and blockers"],
      ["Safety fixes route", appSource, "Safety fixes"]
    ];
    for (const [label, text, token] of routeTokens) {
      assertIncludes(label, text, token);
    }

    const realDailyTokens = [
      ["Real daily sample", appSource, "BSP-MIC-0197"],
      ["Real daily RDB id", appSource, "PD-RDB-226231"],
      ["Real daily HRS code", appSource, "PRICE-HRS"],
      ["Prior approval condition", appSource, "Prior Approval Required"],
      ["RDB history source", appSource, "RDB SYSTEM"],
      ["Daily saved history", appSource, "A Daily Was Saved"],
      ["Daily created history", appSource, "A Daily Has Been Created"],
      ["Structured daily history renderer", appSource, "function renderProductionDailyHistoryItem"],
      ["Structured history styles", styles, "daily-history-changes"]
    ];
    for (const [label, text, token] of realDailyTokens) {
      assertIncludes(label, text, token);
    }

    const workflowTighteningTokens = [
      ["Role workflow tightening panel", appSource, "renderRoleWorkflowTighteningPanel"],
      ["Foreman My Dailies panel", appSource, "renderForemanMyDailiesPanel"],
      ["Foreman code confidence", appSource, "renderProductionForemanCodeConfidencePanel"],
      ["SQUAN export history panel", appSource, "renderSquanPackageExportHistoryPanel"],
      ["SQUAN Tracker field map", appSource, "squanTrackerFieldMap"],
      ["SQUAN Tracker validation", appSource, "validateSquanTrackerRecordRows"],
      ["Manual SQUAN Tracker copy", appSource, "manual entry into the outside SQUAN Tracker"],
      ["Role action matrix", appSource, "roleActionMatrix"],
      ["Unauthorized action guard", appSource, "guardRoleAction"],
      ["Owner exception dashboard", appSource, "renderOwnerExceptionDashboard"],
      ["Workflow count strip styles", styles, "workflow-count-strip"],
      ["Foreman daily list styles", styles, "foreman-my-daily-list"],
      ["Owner exception list styles", styles, "owner-exception-list"]
    ];
    for (const [label, text, token] of workflowTighteningTokens) {
      assertIncludes(label, text, token);
    }

    const roleNavExpectations = [
      ["Admin sidebar", 'Admin: ["dashboard", "projects", "money", "risk", "reports", "settings"]'],
      ["Operations sidebar", 'Operations: ["dashboard", "projects", "production", "field", "time", "documents", "people", "equipment", "risk", "reports"]'],
      ["Foreman sidebar", 'Foreman: ["dashboard", "production", "field", "time", "documents", "risk"]'],
      ["Crew Member sidebar", '"Crew Member": ["dashboard", "projects", "production", "field", "time", "documents", "risk"]'],
      ["Billing sidebar", 'Billing: ["dashboard", "projects", "production", "documents", "money", "time", "reports"]'],
      ["Safety sidebar", '"Safety/Compliance": ["dashboard", "projects", "risk", "people", "equipment", "documents", "field", "time", "reports"]']
    ];
    for (const [label, token] of roleNavExpectations) {
      assertIncludes(label, appSource, token);
    }

    const viewRenderExpectations = [
      "dashboard",
      "tasks",
      "documents",
      "projects",
      "field",
      "production",
      "time",
      "people",
      "equipment",
      "money",
      "risk",
      "reports",
      "settings"
    ];
    for (const view of viewRenderExpectations) {
      assertIncludes(`Render route ${view}`, appSource, `state.view === "${view}"`);
    }

    const routeAttrs = uniqueValues([...appSource.matchAll(/data-([a-z0-9-]+)(?:=|\])/gi)]
      .map(match => match[1])
      .filter(attr => [
        "open-record",
        "task-open",
        "view",
        "view-shortcut"
      ].includes(attr) || attr.startsWith("workflow")));
    const passiveRouteAttrs = new Set([
      "workflow-focus",
      "workflow-id",
      "workflow-target"
    ]);
    const unhandledRouteAttrs = routeAttrs.filter(attr => !handledAttrs.has(attr) && !passiveRouteAttrs.has(attr));
    if (unhandledRouteAttrs.length) {
      throw new Error(`Unhandled workflow route attributes: ${unhandledRouteAttrs.map(attr => `data-${attr}`).join(", ")}`);
    }

    const csvExpectations = [
      ["/api/reports/approved-production.csv", ["dataMode", "sourceSummary", "dailyId", "mapNtp", "code", "quantity", "squanBillableAmount"]],
      ["/api/reports/ready-to-submit.csv", ["dataMode", "sourceSummary", "packageKey", "dailyId", "squanBillableAmount", "blockers"]],
      ["/api/reports/billing-package.csv?key=WORKFLOW-QA-NO-ROWS", ["dataMode", "sourceSummary", "packageKey", "dailyId", "squanBillableAmount", "contractorPayableAmount", "proofStatus"]],
      ["/api/reports/squan-tracker-record.csv?key=WORKFLOW-QA-NO-ROWS", ["dataMode", "sourceSummary", "mapNtp", "dailyId", "billingCode", "quantity", "recordkeepingNote"]],
      ["/api/reports/billing-package-payments.csv", ["dataMode", "sourceSummary", "packageKey", "squanPaidAmount", "squanHoldbackAmount", "contractorPaidAmount"]],
      ["/api/reports/billing-package-lifecycle.csv", ["dataMode", "sourceSummary", "packageKey", "packageStatus", "submissionStatus", "approvedAmount", "responseVariance", "nextAction"]],
      ["/api/reports/billing-package-exceptions.csv", ["dataMode", "sourceSummary", "packageKey", "exceptionType", "detail", "owner"]],
      ["/api/reports/contractor-settlements.csv", ["dataMode", "sourceSummary", "settlementId", "contractor", "grossAmount", "deductionTotal", "netDue"]],
      ["/api/reports/contractor-agreements.csv", ["dataMode", "sourceSummary", "agreementId", "contractor", "contractorShare", "jacksonShare"]],
      ["/api/reports/contractor-deductions.csv", ["dataMode", "sourceSummary", "deductionId", "settlementId", "category", "amount", "reason"]],
      ["/api/reports/contractor-unpaid.csv", ["settlementId", "balance", "paymentStatus"]],
      ["/api/reports/contractor-holdbacks.csv", ["settlementId", "packageKey", "status"]],
      ["/api/reports/contractor-disputed.csv", ["settlementId", "status", "balance"]],
      ["/api/reports/contractor-settlement-payments.csv", ["dataMode", "sourceSummary", "paymentId", "settlementId", "amount", "reference"]],
      ["/api/reports/price-sheet-catalog.csv", ["dataMode", "sourceSummary", "code", "subRate", "sourceType", "readiness", "usedLineCount", "submittedQuantity"]],
      ["/api/reports/operational-readiness.csv", ["area", "owner", "status", "detail", "blockers"]],
      ["/api/reports/operational-cleanup.csv", ["type", "owner", "severity", "status", "project", "sourceId", "detail", "action", "focus"]],
      ["/api/reports/operational-closeout.csv", ["item", "owner", "status", "detail"]],
      ["/api/reports/imported-submissions.csv", ["dataMode", "sourceSummary", "sourceId", "project", "workedDate", "code", "quantity", "resubmissionStatus"]],
      ["/api/reports/resubmission-comparison.csv", ["sourceId", "jacksonDailyId", "projectMatch", "dateMatch", "codeStatus", "quantityMatch", "billingReadiness"]],
      ["/api/reports/demo-archive.csv", ["collection", "id", "project", "classification", "status", "owner"]]
    ];

    for (const [pathname, headers] of csvExpectations) {
      const header = firstCsvLine(await getText(baseUrl, pathname, token));
      for (const expected of headers) {
        assertIncludes(pathname, header, expected);
      }
    }

    console.log(`Workflow confidence QA passed on ${baseUrl}`);
  } catch (error) {
    console.error("Workflow confidence QA failed.");
    if (serverOutput.length) {
      console.error(serverOutput.filter(Boolean).slice(-10).join("\n"));
    }
    throw error;
  } finally {
    server.kill();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

run().catch(error => {
  console.error(error.message);
  process.exit(1);
});
