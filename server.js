const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 8080);
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, "data", "db.json");
const PUBLIC_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

const collections = new Set([
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
  "customerContactLog"
]);

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, `${JSON.stringify(db, null, 2)}\n`);
}

function send(res, status, body, type = "application/json; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store"
  });
  res.end(type.startsWith("application/json") ? JSON.stringify(body) : body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => {
      body += chunk;
      if (body.length > 1_000_000) {
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

function csv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);
  const escape = value => `"${String(value ?? "").replaceAll('"', '""')}"`;
  return [
    headers.map(escape).join(","),
    ...rows.map(row => headers.map(header => escape(row[header])).join(","))
  ].join("\n");
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
  const db = readDb();
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "GET" && url.pathname === "/api/health") {
    return send(res, 200, { ok: true, app: "Jackson Telcom ERP" });
  }

  if (req.method === "GET" && url.pathname === "/api/bootstrap") {
    return send(res, 200, { ...db, summary: summarize(db) });
  }

  if (req.method === "POST" && url.pathname === "/api/auth/login") {
    const body = await parseBody(req);
    const user = db.users.find(item => item.email === body.email);
    if (!user || body.password !== "demo") {
      return send(res, 401, { error: "Invalid email or password" });
    }
    appendAudit(db, "auth.login", { user: user.email });
    writeDb(db);
    return send(res, 200, { user, token: `demo-${user.id}` });
  }

  if (req.method === "POST" && url.pathname === "/api/records/update") {
    const body = await parseBody(req);
    const next = updateRecord(db, body.collection, body.id, body.patch || {});
    if (!next) return send(res, 404, { error: "Record not found" });
    appendAudit(db, `${body.collection}.update`, { id: body.id });
    if (next.project) recomputeProject(db, next.project);
    writeDb(db);
    return send(res, 200, next);
  }

  if (req.method === "POST" && url.pathname === "/api/records/note") {
    const body = await parseBody(req);
    const next = addNote(db, body.collection, body.id, body.note, body.by);
    if (!next) return send(res, 404, { error: "Record not found" });
    writeDb(db);
    return send(res, 200, next);
  }

  if (req.method === "POST" && url.pathname === "/api/records/status") {
    const body = await parseBody(req);
    const next = changeStatus(db, body.collection, body.id, body.status, body.by);
    if (!next) return send(res, 404, { error: "Record not found" });
    if (next.project) recomputeProject(db, next.project);
    writeDb(db);
    return send(res, 200, next);
  }

  if (req.method === "PUT" && url.pathname === "/api/company/cash-controls") {
    const body = await parseBody(req);
    const company = updateCashControls(db, body);
    writeDb(db);
    return send(res, 200, {
      company,
      cashForecast: reportCashForecast(db, body.scenario || "baseline")
    });
  }

  if (req.method === "PUT" && url.pathname === "/api/company/closeout-readiness-sla") {
    const body = await parseBody(req);
    const company = updateCloseoutReadinessSlaControls(db, body);
    writeDb(db);
    return send(res, 200, { company });
  }

  if (req.method === "PUT" && url.pathname === "/api/company/daily-package-sla") {
    const body = await parseBody(req);
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
        by: body.by || receipt.receivedBy || "Billing",
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

  if (req.method === "POST" && url.pathname === "/api/workflows/submit-daily") {
    const body = await parseBody(req);
    const daily = body.daily || {};
    if (!daily.id || !daily.project) return send(res, 400, { error: "daily.id and daily.project are required" });

    const existingDailyIndex = db.dailies.findIndex(item => item.id === daily.id);
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
    appendAudit(db, "workflow.submitDaily", { dailyId: daily.id, project: daily.project, qc: qcRecord.id, by: submittedDaily.foreman || "Foreman" });
    writeDb(db);
    return send(res, 200, { daily: submittedDaily, project, readiness });
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
    return send(res, 200, csv(db[parts[2]]), "text/csv; charset=utf-8");
  }

  if (parts[0] === "api" && collections.has(parts[1])) {
    const collection = parts[1];
    const id = decodeURIComponent(parts[2] || "");
    db[collection] = db[collection] || [];

    if (req.method === "GET") {
      if (!id) return send(res, 200, db[collection]);
      const record = db[collection].find(item => item.id === id);
      return record ? send(res, 200, record) : send(res, 404, { error: "Record not found" });
    }

    if (req.method === "POST") {
      const body = await parseBody(req);
      if (!body.id) body.id = `${collection.toUpperCase()}-${Date.now()}`;
      db[collection].push(body);
      appendAudit(db, `${collection}.create`, { id: body.id });
      writeDb(db);
      return send(res, 201, body);
    }

    if (req.method === "PUT" && id) {
      const body = await parseBody(req);
      const index = db[collection].findIndex(item => item.id === id);
      if (index === -1) return send(res, 404, { error: "Record not found" });
      db[collection][index] = { ...body, id };
      appendAudit(db, `${collection}.update`, { id });
      writeDb(db);
      return send(res, 200, db[collection][index]);
    }

    if (req.method === "DELETE" && id) {
      const index = db[collection].findIndex(item => item.id === id);
      if (index === -1) return send(res, 404, { error: "Record not found" });
      const [deleted] = db[collection].splice(index, 1);
      appendAudit(db, `${collection}.delete`, { id });
      writeDb(db);
      return send(res, 200, deleted);
    }
  }

  return send(res, 404, { error: "API route not found" });
}

function serveFile(req, res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const filePath = path.normalize(path.join(ROOT, requested));
  if (!filePath.startsWith(ROOT)) return send(res, 403, "Forbidden", "text/plain; charset=utf-8");
  fs.readFile(filePath, (error, content) => {
    if (error) return send(res, 404, "Not found", "text/plain; charset=utf-8");
    const type = PUBLIC_TYPES[path.extname(filePath)] || "application/octet-stream";
    send(res, 200, content, type);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
    } else {
      serveFile(req, res, url);
    }
  } catch (error) {
    send(res, 500, { error: error.message });
  }
});

server.listen(PORT, () => {
  console.log(`Jackson Telcom ERP running at http://127.0.0.1:${PORT}`);
});
