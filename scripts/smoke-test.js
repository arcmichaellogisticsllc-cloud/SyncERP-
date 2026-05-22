const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const db = JSON.parse(fs.readFileSync(path.join(root, "data", "db.json"), "utf8"));

const requiredCollections = [
  "projects",
  "tasks",
  "documents",
  "fieldEvidence",
  "dailies",
  "people",
  "equipment",
  "invoices",
  "safety",
  "billingReadiness",
  "users",
  "roles",
  "formSubmissions",
  "offlineSyncQueue",
  "fieldUploadQueue",
  "customerContactLog",
  "packetLocks",
  "packageSnapshots",
  "contractorAgreements",
  "contractorSettlements",
  "contractorSettlementDeductions",
  "contractorSettlementPayments"
];

const failures = [];
const ids = collection => new Set((db[collection] || []).map(item => item.id));
const projectIds = ids("projects");
const roleIds = ids("roles");

for (const collection of requiredCollections) {
  if (!Array.isArray(db[collection])) failures.push(`Missing collection: ${collection}`);
}

for (const project of db.projects || []) {
  if (!(db.billingReadiness || []).some(item => item.project === project.id)) {
    failures.push(`Project missing billing readiness: ${project.id}`);
  }
}

for (const collection of ["tasks", "documents", "fieldEvidence", "dailies", "timeEntries", "safety", "invoices", "billingReadiness", "formSubmissions", "offlineSyncQueue", "fieldUploadQueue", "customerContactLog", "photoEvidence", "siteSurveys", "obstacles", "qcCloseouts", "packageSnapshots", "productionDailies", "productionLines", "contractorPayables", "contractorSettlements", "contractorSettlementDeductions", "contractorSettlementPayments", "techWorkEntries", "billingLedger", "quantityReconciliation"]) {
  for (const record of db[collection] || []) {
    if (record.project && !projectIds.has(record.project)) {
      failures.push(`${collection}.${record.id} references missing project ${record.project}`);
    }
  }
}

for (const user of db.users || []) {
  if (!roleIds.has(user.role)) failures.push(`User ${user.id} references missing role ${user.role}`);
}

for (const [collection, rows] of Object.entries(db)) {
  if (!Array.isArray(rows)) continue;
  for (const record of rows) {
    if (!record || typeof record !== "object" || !record.id) continue;
    for (const field of ["notes", "activityLog", "createdAt", "modifiedAt"]) {
      if (record[field] === undefined) failures.push(`${collection}.${record.id} missing ${field}`);
    }
    if (!Array.isArray(record.activityLog)) failures.push(`${collection}.${record.id} activityLog is not an array`);
  }
}

if (!db.meta?.dataVersion) failures.push("Missing db.meta.dataVersion");

const appSource = fs.readFileSync(path.join(root, "src", "app.js"), "utf8");
const serverSource = fs.readFileSync(path.join(root, "server.js"), "utf8");
const workflowAliases = [
  "Project & Map Hub",
  "Documents",
  "Field Operations",
  "Time Tracking",
  "Billing",
  "Safety & Risk",
  "People & Compliance",
  "Equipment",
  "Reports",
  "Tasks",
  "Settings"
];

for (const alias of workflowAliases) {
  if (!appSource.includes(`"${alias}"`)) {
    failures.push(`Missing workflow route alias in app source: ${alias}`);
  }
}

const roleRestoreTokens = [
  ["Session role sync", "state.role !== state.user.role"],
  ["Session owner view sync", "applyMapOwnerView(ownerViewForRole(state.role))"]
];

for (const [label, token] of roleRestoreTokens) {
  if (!appSource.includes(token)) {
    failures.push(`Missing role restore requirement: ${label}`);
  }
}

const requiredRoleViews = {
  Admin: ["dashboard", "projects", "tasks", "documents", "field", "time", "people", "equipment", "money", "risk", "reports", "settings"],
  Foreman: ["dashboard", "projects", "field", "time", "documents", "equipment", "risk"],
  Operations: ["dashboard", "projects", "field", "time", "documents", "people", "equipment", "risk", "reports"],
  Billing: ["dashboard", "projects", "documents", "field", "time", "reports"],
  "Safety/Compliance": ["dashboard", "risk", "projects", "documents", "people", "equipment", "field", "time", "reports"],
  "Crew Member": ["dashboard", "field", "time", "projects", "documents", "equipment", "risk"]
};

const requiredRoleCreates = {
  Admin: ["documents", "fieldUploadQueue", "customerContactLog"],
  Foreman: ["documents", "dailies", "fieldUploadQueue"],
  Operations: ["documents", "fieldUploadQueue"],
  Billing: ["documents", "customerContactLog"],
  "Safety/Compliance": ["documents", "safety", "fieldUploadQueue"],
  "Crew Member": ["fieldUploadQueue", "safety"]
};

for (const role of db.roles || []) {
  const requiredViews = requiredRoleViews[role.id] || [];
  const requiredCreates = requiredRoleCreates[role.id] || [];
  if (role.defaultView && !role.views?.includes(role.defaultView)) {
    failures.push(`Role ${role.id} defaultView is not in views`);
  }
  for (const view of requiredViews) {
    if (!role.views?.includes(view)) failures.push(`Role ${role.id} missing required view ${view}`);
  }
  for (const collection of requiredCreates) {
    if (!role.create?.includes(collection)) failures.push(`Role ${role.id} missing required create permission ${collection}`);
  }
}

const requiredFunctions = [
  "renderFieldCaptureUploadFoundation",
  "openFileUploadDrawer",
  "saveFileUploadIntake",
  "renderSquanPacketBuilderWorkflow",
  "renderCustomerContactLog",
  "renderCrewTimeConfirmationWorkflow",
  "normalizeDataShape",
  "navigationForRole",
  "renderSimpleRoleHome",
  "roleHomeProfile"
];

for (const fn of requiredFunctions) {
  if (!appSource.includes(`function ${fn}`)) failures.push(`Missing MVP hardening function: ${fn}`);
}

const criticalMapIds = ["PO-SQ-24018", "PO-SQ-24022", "PO-SQ-24031"];
for (const id of criticalMapIds) {
  if (!projectIds.has(id)) failures.push(`Missing critical demo Map: ${id}`);
  if (!(db.documents || []).some(item => item.project === id)) failures.push(`Critical Map ${id} has no document evidence`);
}

const sourceTokens = [
  ["Operations beginning-phase route", "renderBeginningPhaseWorkflow"],
  ["Operations release prep action board", "renderOperationsReleasePrep"],
  ["Operations release prep rows", "operationsReleasePrepRows"],
  ["Operations release prep CSS", "operations-release-prep"],
  ["Operations daily review queue", "renderOperationsDailyReviewQueue"],
  ["Operations daily review rows", "operationsDailyReviewRows"],
  ["Operations corrected daily comparison", "renderDailyCorrectionReviewCard"],
  ["Returned daily task pending review", "markReturnedDailyTasksPendingReview"],
  ["Operations daily review CSS", "operations-daily-review"],
  ["Operations release gate", "renderReleaseGateReview"],
  ["Operations Field Maps readiness", "fieldMapsReadiness"],
  ["Foreman daily start", "renderMobileDailyWizard"],
  ["Foreman daily start command", "renderForemanDailyStartCommand"],
  ["Foreman daily start rows", "foremanDailyStartRows"],
  ["Foreman daily command actions", "data-daily-command-action"],
  ["Foreman returned daily fix loop", "renderForemanReturnedFixLoop"],
  ["Foreman returned daily rows", "returnedDailyFixRows"],
  ["Foreman returned daily CSS", "foreman-returned-loop"],
  ["Foreman My Dailies status panel", "renderForemanMyDailiesPanel"],
  ["Role workflow tightening panel", "renderRoleWorkflowTighteningPanel"],
  ["Role workflow counts", "roleWorkflowCounts"],
  ["Operational role dashboard", "renderOperationalRoleDashboard"],
  ["Operational role work items", "operationalRoleWorkItems"],
  ["Operational work queue marker", "data-operational-work-queue"],
  ["Role action permission matrix", "roleActionMatrix"],
  ["Role action guard", "guardRoleAction"],
  ["Foreman start gate enforcement", "fieldStartGate"],
  ["Foreman daily requirement source", "renderDailyRequirementSourcePanel"],
  ["Submitted daily lock view", "renderSubmittedDailyLockedView"],
  ["Daily acceptance status helper", "function dailyAcceptanceStatus"],
  ["Daily safety routing", "routeDailySafetyReviewItems"],
  ["Foreman file capture", "renderFieldCaptureUploadFoundation"],
  ["Crew time confirmation", "renderCrewTimeConfirmationWorkflow"],
  ["Safety field capture review", "renderFieldCaptureReviewPanel"],
  ["Safety Form 12 workflow", "renderForm12Flow"],
  ["Billing SQUAN packet builder", "renderSquanPacketBuilderWorkflow"],
  ["Billing accepted daily gate", "renderAcceptedDailyBillingGate"],
  ["Billing accepted daily gate state", "acceptedDailyBillingGate"],
  ["Billing accepted daily gate CSS", "accepted-daily-billing-gate"],
  ["Billing production invoice ledger", "renderProductionToInvoiceLedger"],
  ["Billing package command view", "renderBillingPackageCommandView"],
  ["Billing package workflow rows", "billingPackageWorkflowRows"],
  ["Billing package detail view", "renderBillingPackageDetailView"],
  ["Billing package admin visibility", "renderBillingPackageAdminVisibility"],
  ["Approved production CSV export", "approvedProductionCsvRows"],
  ["Ready to submit CSV export", "readyToSubmitCsvRows"],
  ["Billing package CSV export", "billingPackageCsvRows"],
  ["Billing package prepare action", "createDailyBillingPackageSnapshot"],
  ["Billing package submit action", "submitDailyBillingPackage"],
  ["Billing package submission drawer", "openBillingPackageSubmissionDrawer"],
  ["Billing package response action", "updateDailyBillingPackageResponse"],
  ["Billing package response drawer", "openBillingPackageResponseDrawer"],
  ["Billing package money snapshot", "billingPackageMoneySnapshot"],
  ["Billing package rate audit rows", "billingPackageRateAuditRows"],
  ["Billing package rate blockers", "billingPackageRateBlockers"],
  ["Billing package rate override", "handleBillingRateOverride"],
  ["Billing package rate audit UI", "billing-rate-audit"],
  ["Billing package rate source", "rateSourceForCode"],
  ["Billing package payment summary", "billingPackagePaymentSummary"],
  ["Billing package payment action", "recordBillingPackagePayment"],
  ["Billing package payment drawer", "openBillingPackagePaymentDrawer"],
  ["Billing package action readiness", "renderBillingPackageActionReadiness"],
  ["Billing submit today dashboard", "renderBillingSubmitTodayDashboard"],
  ["Billing duplicate protection", "billingPackageDuplicateRisk"],
  ["Billing package readiness checklist", "billingPackageReadinessChecklist"],
  ["Billing correction package", "createSquanCorrectionPackage"],
  ["Billing submitted line snapshot", "submittedLineSnapshots"],
  ["Billing package payment export", "/api/reports/billing-package-payments.csv"],
  ["Billing package payment CSV rows", "billingPackagePaymentCsvRows"],
  ["Billing package lifecycle report", "renderBillingPackageLifecycleReport"],
  ["Billing package lifecycle export", "/api/reports/billing-package-lifecycle.csv"],
  ["Billing package exceptions report", "renderBillingPackageExceptionsReport"],
  ["Billing package exceptions export", "/api/reports/billing-package-exceptions.csv"],
  ["Price sheet catalog rows", "productionPriceSheetCatalogRows"],
  ["Price sheet control panel", "renderProductionBillingCodeControlPanel"],
  ["Price sheet catalog export", "/api/reports/price-sheet-catalog.csv"],
  ["Real data source classifier", "function dataSourceMode"],
  ["Real source classification", "function dataSourceClassification"],
  ["Real submission preservation panel", "renderRealSubmissionPreservationPanel"],
  ["Real imported submission rows", "realSubmissionRows"],
  ["Resubmission comparison rows", "resubmissionComparisonRows"],
  ["Demo archive rows", "demoArchiveRows"],
  ["Real submission action handler", "handleRealSubmissionAction"],
  ["Imported submissions export", "/api/reports/imported-submissions.csv"],
  ["Resubmission comparison export", "/api/reports/resubmission-comparison.csv"],
  ["Demo archive export", "/api/reports/demo-archive.csv"],
  ["Operational data readiness gate", "function operationalDataReadiness"],
  ["Data mode warning banner", "function renderDataModeBanner"],
  ["Data readiness dashboard", "function renderDataReadinessDashboard"],
  ["Data readiness dashboard marker", "data-data-readiness-dashboard"],
  ["Data source CSV label", "sourceSummary"],
  ["Operational completion panel", "renderOperationalCompletionPanel"],
  ["Operational completion checklist", "operationalCompletionChecklist"],
  ["Operational closeout checklist", "operationalCloseoutChecklist"],
  ["Operational closeout panel", "renderOperationalCloseoutPanel"],
  ["Required field matrix", "operationalRequiredFieldMatrix"],
  ["Record locking rules", "operationalRecordLockRules"],
  ["Exception paths", "operationalExceptionPaths"],
  ["Operational closeout export", "/api/reports/operational-closeout.csv"],
  ["Operational cleanup queue", "renderOperationalCleanupQueue"],
  ["Operational cleanup task creation", "createOperationalCleanupTask"],
  ["Operational readiness export", "/api/reports/operational-readiness.csv"],
  ["Operational cleanup export", "/api/reports/operational-cleanup.csv"],
  ["Server backup endpoint", "/api/admin/backup"],
  ["Restore validation endpoint", "/api/admin/restore/validate"],
  ["Go-live mode endpoint", "/api/admin/go-live-mode"],
  ["Go-live mode save", "saveGoLiveMode"],
  ["Backup restore control", "restoreBackupFromFile"],
  ["MAMP MySQL persistence note", "MAMP MySQL migration next"],
  ["Protected delete guard", "protectedDeleteReason"],
  ["Billing package timeline", "renderBillingPackageTimeline"],
  ["SQUAN actual paid field", "squanPaidAmount"],
  ["Contractor payable snapshot field", "contractorPayableSnapshot"],
  ["Billing package status lanes", "billing-admin-status-lanes"],
  ["Approved production export route", "/api/reports/approved-production.csv"],
  ["Ready to submit export route", "/api/reports/ready-to-submit.csv"],
  ["Selected billing package export route", "/api/reports/billing-package.csv"],
  ["SQUAN Tracker record export route", "/api/reports/squan-tracker-record.csv"],
  ["Billing line review controls", "handleBillingLedgerLineReview"],
  ["Billing line correction task", "createBillingLineCorrectionTask"],
  ["Billing line source versioning", "sourceVersionKey"],
  ["Billing stale line review guard", "staleReview"],
  ["Billing re-review shortcut", "renderBillingLineRereviewShortcut"],
  ["Billing re-review rows", "billingLineRereviewRows"],
  ["Billing re-review CSS", "billing-rereview-shortcut"],
  ["Billing contact log", "renderCustomerContactLog"],
  ["Billing retainage queue", "renderRetainageReleaseQueue"],
  ["Completed forms export report", "renderCompletedFormsExportPackage"],
  ["Report export controls", "data-print-report"]
];

for (const [label, token] of sourceTokens) {
  if (!appSource.includes(token) && !serverSource.includes(token)) failures.push(`Missing MVP workflow breakpoint: ${label}`);
}

const map3 = "PO-SQ-24031";
const map3Requirements = [
  ["Map 3 setup documents", "documents", item => ["Map", "Site Survey", "811"].includes(item.type)],
  ["Map 3 beginning-phase tasks", "tasks", item => /survey|811|release|permit|obstacle|safety/i.test(`${item.title} ${item.source} ${item.notes}`)],
  ["Map 3 site survey", "siteSurveys", item => item.project === map3],
  ["Map 3 obstacle log", "obstacles", item => item.project === map3],
  ["Map 3 offline/Field Maps package", "offlineSyncQueue", item => item.project === map3],
  ["Map 3 safety blockers", "safety", item => item.project === map3],
  ["Map 3 daily starter", "dailies", item => item.project === map3],
  ["Map 3 billing readiness", "billingReadiness", item => item.project === map3]
];

for (const [label, collection, predicate] of map3Requirements) {
  const rows = db[collection] || [];
  if (!rows.some(item => item.project === map3 && predicate(item))) {
    failures.push(`Missing end-to-end seed requirement: ${label}`);
  }
}

const workflowFocusRoutes = [
  ["Field capture focus route", "capture\", \"upload\", \"offline\", \"markup"],
  ["Daily start focus route", "daily start\", \"jsa\", \"ppe\", \"safety start"],
  ["Operations release focus route", "includesAny(\"release\")"],
  ["Safety incident focus route", "form 12\", \"incident\", \"near miss\", \"corrective"],
  ["Billing package focus route", "Invoice package"]
];

for (const [label, token] of workflowFocusRoutes) {
  if (!appSource.includes(token)) failures.push(`Missing guided workflow focus route: ${label}`);
}

const simplifiedUiTokens = [
  ["Role-based home", "simple-home"],
  ["One primary next action", "simple-next-step"],
  ["Role-specific nav order", "roleNavOrder"],
  ["Login lands on Home", "state.view = \"dashboard\""],
  ["Plain ready language", "Ready to work?"],
  ["Plain crew blocker language", "Crew ready?"],
  ["Plain equipment blocker language", "Equipment ready?"]
];

for (const [label, token] of simplifiedUiTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing simplified UI requirement: ${label}`);
  }
}

const crewMemberUiTokens = [
  ["Crew assignment landing", "My Work Today"],
  ["Crew checklist", "My Steps Today"],
  ["Crew field scope explanation", "Anything else belongs to the Foreman, Operations, Office, Safety, or Admin"],
  ["Crew assignment layout", "crew-assignment-strip"],
  ["Crew checklist cards", "crew-check-card"]
];

for (const [label, token] of crewMemberUiTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing Crew Member simplified UI requirement: ${label}`);
  }
}

const foremanUiTokens = [
  ["Foreman daily cockpit", "foreman-daily-home"],
  ["Foreman command primary", "function foremanPrimaryAction"],
  ["Foreman owned fixes", "function renderForemanOwnedNeedsFix"],
  ["Foreman focused work", "function renderForemanFocusedWork"],
  ["Foreman daily steps", "Today's work path"],
  ["Foreman simple flow", "renderForemanSimpleDailyFlow"],
  ["Foreman Pre-Check", "Finish Pre-Check"],
  ["Foreman submit step", "Submit Today’s Daily"],
  ["Foreman locked daily language", "Submitted Daily Locked"],
  ["Foreman mobile layout", "foreman-simple-step"]
];

for (const [label, token] of foremanUiTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing Foreman simplified UI requirement: ${label}`);
  }
}

const operationsUiTokens = [
  ["Operations map mover", "renderOperationsMapMover"],
  ["Operations setup path", "renderOperationsSetupPath"],
  ["Operations Map queue", "renderOperationsMapQueue"],
  ["Operations quick tools", "renderOperationsQuickTools"],
  ["Operations plain ready language", "Ready to work?"],
  ["Operations step cards", "operations-step-card"]
];

for (const [label, token] of operationsUiTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing Operations simplified UI requirement: ${label}`);
  }
}

const billingUiTokens = [
  ["Billing slice command", "renderBillingCommandCenterSlice"],
  ["Selected Map billing panel", "renderSelectedMapBillingPanel"],
  ["Billing code breakdown", "renderBillingCodeBreakdownPanel"],
  ["Billing five-step path", "renderBillingFiveStepSlice"],
  ["Billing work queues", "renderBillingQueueTabs"],
  ["Billing plain action", "Bill, submit, collect"],
  ["Billing step cards", "billing-five-step"]
];

for (const [label, token] of billingUiTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing Billing simplified UI requirement: ${label}`);
  }
}

const safetyUiTokens = [
  ["Safety simple home", "renderSafetyWorkHome"],
  ["Safety clear return path", "renderSafetyClearReturnPath"],
  ["Safety Map queue", "renderSafetyMapQueue"],
  ["Safety quick tools", "renderSafetyQuickTools"],
  ["Safety plain fixes", "Safety fixes"],
  ["Safety step cards", "safety-step-card"]
];

for (const [label, token] of safetyUiTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing Safety simplified UI requirement: ${label}`);
  }
}

const plainLanguageTokens = [
  ["Plain proof label", "Files / Proof"],
  ["Plain billing label", "Billing"],
  ["Plain field label", "Today’s Work"],
  ["Plain held-back money wording", "10% Retainage"],
  ["Plain unpaid wording", "Unpaid follow-up"],
  ["Plain payment ledger wording", "Map Payment Ledger"],
  ["Payment ledger row helper", "function mapPaymentLedgerRows"],
  ["Payment ledger row renderer", "function renderMapPaymentLedgerRow"],
  ["Payment ledger invoice sent column", "Invoice sent"],
  ["Payment ledger close billing column", "Close billing"],
  ["Billing slice command view", "function renderBillingCommandCenterSlice"],
  ["Billing selected map panel", "function renderSelectedMapBillingPanel"],
  ["Billing code breakdown", "function renderBillingCodeBreakdownPanel"],
  ["Billing five-step wording", "Five steps only"],
  ["Billing daily work wording", "Bill, submit, collect"],
  ["Daily requirement wording", "Daily requirements"],
  ["Daily guided workflow", "Daily work path"],
  ["Daily form output preview", "What this daily will export"],
  ["Daily accepted status wording", "Used for Billing"],
  ["Operations clarification action", "Ask Clarification"],
  ["Morning street sheet form", "Morning Street Sheet"],
  ["Completed forms export wording", "Completed Forms Export"],
  ["Printable daily form layouts", "function renderDailyFormPrintLayouts"],
  ["Completed forms server endpoint", "/api/reports/completed-forms.csv"],
  ["Production invoice ledger wording", "Production to invoice ledger"],
  ["Production invoice ledger helper", "function productionToInvoiceLedger"],
  ["Billing work-to-do wording", "Work queues"],
  ["Plain payment detail wording", "Payment Detail"],
  ["Plain billing close wording", "Closed / Billed"],
  ["Plain 10 percent held wording", "10% Held Back"],
  ["Plain unpaid follow-up panel", "Unpaid money follow-up"],
  ["Plain deposit proof wording", "Deposit Proof"],
  ["Plain status helper", "function plainStatus"],
  ["Sidebar icons", "function navIcon"],
  ["Sidebar action badges", "function navBadgeCount"],
  ["Admin clean sidebar", "Admin: [\"dashboard\", \"projects\", \"money\", \"risk\", \"reports\", \"settings\"]"]
];

for (const [label, token] of plainLanguageTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing plain-language UI requirement: ${label}`);
  }
}

const proofChecklistTokens = [
  ["Proof checklist panel", "Proof Needed"],
  ["Missing proof group", "Missing Proof"],
  ["Needs review group", "Needs Review"],
  ["Accepted proof group", "Ready / Accepted"],
  ["Proof checklist rows", "proof-row"],
  ["Proof tools grid", "proof-tool-grid"]
];

for (const [label, token] of proofChecklistTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing proof checklist UI requirement: ${label}`);
  }
}

const compactQueueTokens = [
  ["Safety work grouped panel", "Safety Work"],
  ["Safety work helper", "renderSafetyWorkGroup"],
  ["Shared status pills do not stretch", "packet-home-list article > .status"],
  ["Plain missing safety proof", "Missing safety proof"],
  ["Admin decisions grouped", "renderAdminDecisionGroup"],
  ["Billing work grouped", "renderBillingQueueTabs"],
  ["Task first actions", "Tasks To Do First"],
  ["Collections grouped", "renderCollectionsWorkGroup"],
  ["Collections plain title", "Collections Follow-Up"]
];

for (const [label, token] of compactQueueTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing compact queue UI requirement: ${label}`);
  }
}

const workflowPathTokens = [
  ["Workflow path home", "renderWorkflowPathHome"],
  ["Workflow path definitions", "workflowPathDefinitions"],
  ["Workflow stepper", "renderWorkflowStepper"],
  ["Guided Needs Fix rows", "function guidedNeedsFixRows"],
  ["Guided Needs Fix center", "function renderGuidedNeedsFixCenter"],
  ["Guided Needs Fix drawer", "function openNeedsFixDrawer"],
  ["Guided Needs Fix workflow route", "function openNeedsFixWorkflow"],
  ["Guided Needs Fix remedy drawer", "function openNeedsFixRemedyDrawer"],
  ["Guided Needs Fix remedy request", "function requestNeedsFixOwnerRemedy"],
  ["Guided Needs Fix remedy start", "Start remedy now"],
  ["Guided Needs Fix role action guard", "function canActOnNeedsFix"],
  ["Guided Needs Fix clickable steps", "function renderNeedsFixStepButton"],
  ["Guided Needs Fix task link", "TASK-NEEDS-FIX"],
  ["Guided Needs Fix return", "function returnNeedsFixTask"],
  ["Guided Needs Fix exception", "function acceptNeedsFixException"],
  ["Guided Needs Fix map detail", "Needs Fix first"],
  ["Guided Needs Fix drawer CSS", "needs-fix-drawer"],
  ["Guided Needs Fix step CSS", "needs-fix-step"],
  ["Guided Needs Fix wording", "Needs Fix"],
  ["Guided Needs Fix details label", "Details"],
  ["Guided Needs Fix CSS", "guided-needs-fix"],
  ["Get Map Ready path", "Get Map Ready"],
  ["Do Today's Work path", "Do Today’s Work"],
  ["Fix Problems path", "Fix Problems"],
  ["Bill SQUAN path", "Bill SQUAN"],
  ["Finish Report path", "Finish / Report"],
  ["Path card grid", "workflow-path-card-grid"]
];

for (const [label, token] of workflowPathTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing workflow path UI requirement: ${label}`);
  }
}

const eliteMapTokens = [
  ["Map command hero", "renderMapCommandHero"],
  ["Elite Map visual", "renderEliteMapVisual"],
  ["Map lifecycle bar", "renderMapLifecycleBar"],
  ["Map lifecycle walkthrough", "renderMapLifecycleWalkthrough"],
  ["Map lifecycle 12-step rows", "mapLifecycleWalkthroughRows"],
  ["Map lifecycle next step", "Next required step"],
  ["Map command panels", "renderMapCommandPanels"],
  ["Map health score", "Map Health"],
  ["Map details drawer", "More Map details"],
  ["Map command grid CSS", "map-command-grid"],
  ["Map lifecycle walkthrough CSS", "map-lifecycle-walkthrough"]
];

for (const [label, token] of eliteMapTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing elite Map UI requirement: ${label}`);
  }
}

const arcgisImportTokens = [
  ["ArcGIS footage import drawer", "openArcgisFootageImportDrawer"],
  ["ArcGIS footage save", "saveArcgisFootageImport"],
  ["ArcGIS CSV parser", "parseArcgisFootageRows"],
  ["ArcGIS report evidence class", "ArcGIS Footage Report"],
  ["ArcGIS import button", "data-arcgis-footage-import"],
  ["ArcGIS import summary", "renderArcgisFootageImportSummary"],
  ["ArcGIS footage review panel", "renderArcgisFootageReviewPanel"],
  ["ArcGIS footage review handler", "handleArcgisFootageReview"],
  ["ArcGIS accepted billing gate", "ArcGIS footage accepted"],
  ["ArcGIS review actions", "data-arcgis-footage-review"]
];

for (const [label, token] of arcgisImportTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing ArcGIS footage import requirement: ${label}`);
  }
}

const quantityReconciliationTokens = [
  ["Quantity reconciliation model", "mapQuantityReconciliation"],
  ["Quantity reconciliation panel", "renderQuantityReconciliationPanel"],
  ["Quantity reconciliation gate", "Quantity reconciled"],
  ["Quantity reconciliation action", "handleQuantityReconciliationAction"],
  ["Quantity reconciliation task", "Quantity reconciliation"],
  ["Quantity reconciliation snapshot", "quantityReconciliation"]
];

for (const [label, token] of quantityReconciliationTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing quantity reconciliation requirement: ${label}`);
  }
}

const importFirstProductionTokens = [
  ["Import-first MVP guidance", "Phase 1 is import-first"],
  ["Production control screen", "renderProductionControl"],
  ["Production import center", "renderProductionImportCenter"],
  ["Production daily form", "renderProductionDailyForm"],
  ["Foreman fast submit strip", "renderForemanDailyFastPath"],
  ["Admin production command view", "renderProductionAdminCommandView"],
  ["Daily Capture mode tabs", "renderProductionModeTabs"],
  ["Daily Capture mode panel", "renderProductionModePanel"],
  ["Daily Capture primary actions", "renderProductionPrimaryActions"],
  ["Foreman code confidence panel", "renderProductionForemanCodeConfidencePanel"],
  ["Billing handoff summary", "renderProductionBillingHandoffSummary"],
  ["SQUAN package export history", "renderSquanPackageExportHistoryPanel"],
  ["SQUAN Tracker field mapping", "squanTrackerFieldMap"],
  ["SQUAN Tracker record validation", "validateSquanTrackerRecordRows"],
  ["Contractor settlement workbench", "renderContractorSettlementWorkbench"],
  ["Contractor agreement versioning", "agreementForContractor"],
  ["Contractor agreement manager", "renderAgreementManager"],
  ["Contractor agreement drawer", "openAgreementDrawer"],
  ["Settlement detail panel", "renderSettlementDetail"],
  ["Settlement issue validation", "settlementIssueValidation"],
  ["Settlement deduction edit", "openSettlementDeductionEditDrawer"],
  ["Contractor settlement deductions", "contractorSettlementDeductions"],
  ["Contractor settlement payment handler", "recordSettlementPayment"],
  ["Outcome export panel", "renderProductionOutcomeExportPanel"],
  ["Daily Capture workflow route modes", "productionModeForWorkflow"],
  ["Reports workflow route modes", "reportModeForWorkflow"],
  ["Admin production lanes", "productionAdminCommandLanes"],
  ["Admin production filters", "renderProductionAdminFilters"],
  ["SQUAN-style daily detail", "renderProductionDailyDetailView"],
  ["Daily drill-in review summary", "renderProductionDailyReviewSummary"],
  ["Billing ready line handoff", "renderProductionBillingReadyLineView"],
  ["Daily detail header", "Daily Detail View"],
  ["Daily capture grouped form", "production-form-section"],
  ["Production daily draft save", "handleProductionDailyDraftSave"],
  ["Production submit validation", "validateProductionDailyCapture"],
  ["Production draft button", "productionSaveDraft"],
  ["Daily detail crew labor", "Crew / Labor"],
  ["Daily detail ArcGIS reference", "ArcGIS Feature Reference"],
  ["Field daily production bridge", "syncFieldDailyToProductionControl"],
  ["Production daily accepted by Billing gate", "sourceCollection === \"productionDailies\""],
  ["Production daily invoice source lines", "Production Control daily line"],
  ["Admin daily production home", "renderAdminDailyProductionSyncHome"],
  ["Admin daily production review", "renderAdminDailyProductionReviewQueue"],
  ["Simplified Admin command center", "renderAdminSimplifiedCommandCenter"],
  ["Admin advanced workflow drawer", "Advanced workflow details"],
  ["Workflow context strip", "renderWorkflowContextBar"],
  ["Normalized workflow status", "workflowStatusBadge"],
  ["Needs work indicator", "Needs work"],
  ["Daily Capture nav label", "Daily Capture"],
  ["Billing compact page subtitle", "Packages, payments, settlements"],
  ["Map daily billing status", "renderMapDailyProductionStatusPanel"],
  ["Daily production audit report", "renderDailyProductionAuditReport"],
  ["Owner exception dashboard", "renderOwnerExceptionDashboard"],
  ["Daily production sync label", "Daily / Production Sync"],
  ["Daily production review label", "Daily / Production Admin Review"],
  ["Daily to billing status label", "Daily to Billing Status"],
  ["Daily production audit label", "Daily / Production Audit Trail"],
  ["Settings sync notice", "workflow-sync-notice"],
  ["Workflow slice plan panel", "renderWorkflowSlicePlanPanel"],
  ["Workflow slice plan rows", "workflowSlicePlanRows"],
  ["Workflow slice plan CSS", "workflow-slice-plan-panel"],
  ["Workflow slice plan doc", "docs/WORKFLOW_SLICE_PLAN.md"],
  ["Closed billed code breakdown", "Closed / Billed"],
  ["Quantity submitted billing metric", "Quantity submitted"],
  ["Daily detail as-builts", "As-Builts / Photos"],
  ["Daily detail history", "Save / Submit History"],
  ["ArcGIS object placeholder", "productionObjectId"],
  ["ArcGIS global placeholder", "productionGlobalId"],
  ["ArcGIS CLLI placeholder", "productionClli"],
  ["ArcGIS feeder placeholder", "productionFeeder"],
  ["ArcGIS point x placeholder", "productionPointX"],
  ["ArcGIS point y placeholder", "productionPointY"],
  ["ArcGIS notes placeholder", "productionArcgisNotes"],
  ["Production review queue", "renderProductionReviewQueue"],
  ["Production ledger", "renderProductionLedger"],
  ["SQUAN CSV import handler", "handleProductionCsvImport"],
  ["Contractor/tech daily submit handler", "handleProductionDailySubmit"],
  ["Jackson production review handler", "handleProductionReview"],
  ["CSV parser", "parseCsvRecords"],
  ["Field evidence collection", "fieldEvidence"],
  ["Contractor payables collection", "contractorPayables"],
  ["Tech work entries collection", "techWorkEntries"],
  ["Billing ledger collection", "billingLedger"],
  ["Import-first docs", "Operational Pay/Billing Production MVP"],
  ["ArcGIS later docs", "Live ArcGIS integration is Phase 4"],
  ["Production proof checklist", "renderProductionProofChecklist"],
  ["Production proof action handler", "handleProductionProofAction"],
  ["Production proof correction task", "requestProductionProofCorrection"],
  ["Production billing package view", "renderProductionBillingPackageView"],
  ["Accepted package rows", "productionBillingPackageRows"],
  ["Approval blocked without proof", "Approval blocked until proof is accepted"],
  ["SQUAN Map Workbench", "renderSquanMapWorkbench"],
  ["SQUAN map features", "squanMapFeatureRows"],
  ["SQUAN map rollups", "squanMapRollups"],
  ["Map feature daily creation", "createProductionDailyFromFeature"],
  ["Map feature collection", "squanMapFeatures"],
  ["Layer feature browser", "Layer / Feature Browser"],
  ["Selected feature detail", "Selected Feature"],
  ["Map-to-daily workflow", "Create Jackson daily from feature"],
  ["Manual feature creation", "openSquanMapFeaturePrompt"],
  ["Manual feature save", "saveSquanMapFeature"],
  ["Feature status update", "updateSquanMapFeatureStatus"],
  ["Batch map-to-daily workflow", "Create daily from selected"],
  ["Batch selected features", "selectedSquanFeatureIds"],
  ["Feature layer filter", "squanFeatureLayerFilter"],
  ["Feature status filter", "squanFeatureStatusFilter"],
  ["Bulk status update", "updateSelectedSquanFeatureStatuses"],
  ["Feature reconciliation rows", "squanFeatureReconciliationRows"],
  ["Feature reconciliation table", "squan-reconciliation-table"],
  ["ArcGIS Phase 4 readiness panel", "renderArcgisPhase4Readiness"],
  ["ArcGIS readiness helper", "arcgisReadinessRows"],
  ["ArcGIS portal URL", "https://jactelops.maps.arcgis.com"],
  ["ArcGIS display name", "jactelops"],
  ["No secret storage warning", "Secrets are not stored in Jackson ERP"]
];

const sampleFiles = [
  ["Price sheet sample", "samples/price-sheet-template.csv"],
  ["SQUAN daily sample", "samples/squan-daily-export-template.csv"],
  ["ArcGIS readiness doc", "docs/ARCGIS_PHASE4_READINESS.md"],
  ["Workflow confidence QA doc", "docs/WORKFLOW_CONFIDENCE_QA.md"]
];

for (const [label, file] of sampleFiles) {
  if (!fs.existsSync(path.join(root, file))) failures.push(`Missing sample/readiness file: ${label}`);
}

const seededCollections = ["priceSheetItems", "squanImports", "squanProductionLines", "squanMapFeatures", "productionDailies", "productionLines", "fieldEvidence", "billingLedger", "quantityReconciliation"];
for (const collection of seededCollections) {
  if (!(db[collection] || []).length) failures.push(`Missing seeded Phase workflow collection rows: ${collection}`);
}

const buildOutline = fs.readFileSync(path.join(root, "docs", "BUILD_OUTLINE.md"), "utf8");
const workflowReview = fs.readFileSync(path.join(root, "docs", "WORKFLOW_MVP_REVIEW.md"), "utf8");
const dataModel = fs.readFileSync(path.join(root, "docs", "DATA_MODEL.md"), "utf8");

for (const [label, token] of importFirstProductionTokens) {
  if (!appSource.includes(token) && !buildOutline.includes(token) && !workflowReview.includes(token) && !dataModel.includes(token)) {
    failures.push(`Missing import-first production requirement: ${label}`);
  }
}

const acceptedPacketTokens = [
  ["Accepted-only packet payload", "function squanPacketAcceptedPayload"],
  ["Accepted packet content preview", "Accepted packet contents"],
  ["Accepted invoice source line gate", "Accepted invoice source lines"],
  ["Accepted-only snapshot marker", "acceptedOnly"],
  ["Accepted packet usage marker", "markAcceptedPacketContentsUsed"],
  ["Accepted packet CSS", "accepted-packet-contents"],
  ["Accepted packet submission guard", "function acceptedPacketSubmissionGuard"],
  ["Accepted packet locked gate", "Accepted packet snapshot locked"],
  ["Submission snapshot link", "packageSnapshotVersion"],
  ["Submission stale packet audit", "acceptedInvoiceLineIds"]
];

for (const [label, token] of acceptedPacketTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing accepted-only packet requirement: ${label}`);
  }
}

const mapLayoutCleanupTokens = [
  ["Map detail shell", "map-detail-shell"],
  ["Collapsed Map selector", "collapsed-project-list"],
  ["Map selector summary", "Filters and list"],
  ["Responsive Map workbench", ".project-hub"]
];

for (const [label, token] of mapLayoutCleanupTokens) {
  if (!appSource.includes(token) && !fs.readFileSync(path.join(root, "src", "styles.css"), "utf8").includes(token)) {
    failures.push(`Missing Map layout cleanup requirement: ${label}`);
  }
}

if (failures.length) {
  console.error("Smoke test failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Smoke test passed.");
