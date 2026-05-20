const assert = require("assert");

function splitCsvLine(line) {
  const cells = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === "\"" && quoted && next === "\"") {
      current += "\"";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else if (char === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current.trim());
  return cells;
}

function parseCsvRecords(text) {
  const lines = String(text || "").split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  if (!lines.length) return [];
  const headers = splitCsvLine(lines[0]).map(header => header.toLowerCase().replace(/[^a-z0-9]+/g, ""));
  return lines.slice(1).map(line => {
    const values = splitCsvLine(line);
    return headers.reduce((record, header, index) => {
      record[header] = values[index] || "";
      return record;
    }, {});
  }).filter(row => Object.values(row).some(Boolean));
}

function csvValue(row, names, fallback = "") {
  for (const name of names) {
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (row[key] !== undefined && row[key] !== "") return row[key];
  }
  return fallback;
}

function upsert(db, collection, record) {
  db[collection] = db[collection] || [];
  const index = db[collection].findIndex(item => item.id === record.id);
  if (index >= 0) db[collection][index] = { ...db[collection][index], ...record };
  else db[collection].push(record);
  return record;
}

function importPriceSheet(db, csvText, fileName = "price-sheet.csv") {
  const rows = parseCsvRecords(csvText);
  rows.forEach((row, index) => {
    const code = csvValue(row, ["code", "unit code", "item code", "work code"]);
    if (!code) return;
    upsert(db, "priceSheetItems", {
      id: `PRICE-${code}`,
      code,
      unitName: csvValue(row, ["unit name", "name", "description"], code),
      description: csvValue(row, ["description", "unit description", "scope"], code),
      uom: csvValue(row, ["uom", "unit", "unit of measure"], "Unit"),
      subRate: Number(csvValue(row, ["contractor rate", "subcontractor rate", "sub rate", "rate", "price"], 0)) || 0,
      aspect: csvValue(row, ["aspect", "category", "work aspect"], "Production"),
      sourceFile: fileName,
      status: "Imported",
      notes: `Price sheet CSV row ${index + 1} imported from ${fileName}.`
    });
  });
  return rows.length;
}

function importSquanDaily(db, csvText, fileName = "squan-daily.csv") {
  const rows = parseCsvRecords(csvText);
  const importId = "SQUAN-IMPORT-TEST";
  let lineCount = 0;
  let totalAmount = 0;
  rows.forEach((row, index) => {
    const code = csvValue(row, ["code", "unit code", "work code", "item code"]);
    const project = csvValue(row, ["ntp", "map", "project", "project id", "job", "job id"], "Unassigned");
    const quantity = Number(csvValue(row, ["quantity", "qty", "units", "footage", "feet"], 0)) || 0;
    const amount = Number(csvValue(row, ["amount", "squan amount", "pay amount", "total", "extended amount"], 0)) || 0;
    if (!code && !quantity && !amount) return;
    lineCount += 1;
    totalAmount += amount;
    upsert(db, "squanProductionLines", {
      id: `SPL-TEST-${index + 1}`,
      importId,
      project,
      ntp: project,
      workedDate: csvValue(row, ["worked date", "work date", "date", "daily date"], "2026-05-19"),
      code,
      quantity,
      uom: csvValue(row, ["uom", "unit"], "Unit"),
      squanAmount: amount,
      description: csvValue(row, ["description", "unit name", "item"], code),
      status: "Imported"
    });
  });
  upsert(db, "squanImports", {
    id: importId,
    sourceFile: fileName,
    sourceType: "SQUAN Daily Export CSV",
    lineCount,
    totalAmount,
    status: lineCount ? "Imported" : "Needs Review"
  });
  return { lineCount, totalAmount };
}

function priceForCode(db, code) {
  return (db.priceSheetItems || []).find(item => item.code === code) || null;
}

function submitProductionDaily(db, input) {
  const price = priceForCode(db, input.code);
  const unitRate = Number(input.unitRate || price?.subRate || 0);
  const dailyId = input.dailyId;
  const lineId = input.lineId;
  const proofStatus = input.proofNote ? "Attached" : "Missing";
  const reviewStatus = input.proofNote ? "Submitted" : "Needs Proof";

  upsert(db, "productionDailies", {
    id: dailyId,
    project: input.project,
    sourceType: input.sourceType,
    submittedBy: input.submittedBy,
    workedDate: input.workedDate,
    status: "Submitted",
    notes: input.proofNote || `${input.sourceType} submitted for Jackson review.`
  });

  upsert(db, "productionLines", {
    id: lineId,
    dailyId,
    sourceType: input.sourceType,
    submittedBy: input.submittedBy,
    project: input.project,
    ntp: input.project,
    workedDate: input.workedDate,
    code: input.code,
    quantity: input.quantity,
    uom: input.code === "TS01" ? "Hours" : price?.uom || "Units",
    unitRate,
    submittedAmount: Math.round(input.quantity * unitRate * 100) / 100,
    reviewStatus,
    payableStatus: input.sourceType.includes("Contractor") ? "Pending Review" : "Job Cost",
    billableStatus: "Pending Review",
    proofStatus,
    notes: input.proofNote || "Proof required before approval."
  });

  if (input.sourceType.includes("Tech")) {
    upsert(db, "techWorkEntries", {
      id: `TECH-${lineId}`,
      productionLineId: lineId,
      project: input.project,
      employee: input.submittedBy,
      workedDate: input.workedDate,
      code: input.code,
      hours: input.code === "TS01" ? input.quantity : 0,
      quantity: input.quantity,
      status: "Submitted"
    });
  }

  if (input.proofNote) {
    upsert(db, "fieldEvidence", {
      id: `FE-${lineId}`,
      project: input.project,
      productionLineId: lineId,
      source: input.sourceType,
      evidenceType: "Note / field proof",
      status: "Submitted",
      notes: input.proofNote
    });
  }
}

function productionLedgerRows(db) {
  const squanByKey = new Map();
  (db.squanProductionLines || []).forEach(line => {
    const key = [line.project || line.ntp || "", line.workedDate || "", line.code || ""].join("|");
    const existing = squanByKey.get(key) || { quantity: 0, amount: 0 };
    existing.quantity += Number(line.quantity || 0);
    existing.amount += Number(line.squanAmount || 0);
    squanByKey.set(key, existing);
  });
  return (db.productionLines || []).map(line => {
    const key = [line.project || line.ntp || "", line.workedDate || "", line.code || ""].join("|");
    const squan = squanByKey.get(key) || { quantity: 0, amount: 0 };
    return {
      ...line,
      squanQuantity: squan.quantity,
      squanAmount: squan.amount,
      varianceQuantity: Number(line.quantity || 0) - squan.quantity,
      status: line.reviewStatus || line.status || "Submitted"
    };
  });
}

function proofState(db, line) {
  const evidence = (db.fieldEvidence || []).filter(item => item.productionLineId === line.id);
  if (evidence.some(item => ["Accepted", "Accepted Exception"].includes(item.status)) || ["Accepted", "Accepted Exception"].includes(line.proofStatus)) return "Accepted";
  if (evidence.length || ["Attached", "Submitted"].includes(line.proofStatus)) return "Needs Review";
  if (["Rejected", "Returned", "Needs Correction"].includes(line.proofStatus)) return "Needs Correction";
  return "Missing";
}

function acceptProof(db, lineId) {
  const line = db.productionLines.find(item => item.id === lineId);
  assert(line, `Missing production line ${lineId}`);
  const evidence = (db.fieldEvidence || []).filter(item => item.productionLineId === lineId);
  assert(evidence.length || ["Attached", "Submitted"].includes(line.proofStatus), `No proof available for ${lineId}`);
  evidence.forEach(item => {
    item.status = "Accepted";
  });
  line.proofStatus = "Accepted";
}

function reviewProductionLine(db, lineId, action) {
  const line = db.productionLines.find(item => item.id === lineId);
  assert(line, `Missing production line ${lineId}`);
  if (action === "approve") {
    if (!["Accepted", "Accepted Exception"].includes(proofState(db, line))) {
      line.reviewStatus = "Needs Proof";
      line.payableStatus = "Hold";
      line.billableStatus = "Hold";
      line.proofStatus = proofState(db, line) === "Needs Review" ? "Needs Review" : "Missing";
      upsert(db, "tasks", {
        id: `TASK-PROD-PROOF-${line.id}`,
        project: line.project,
        relatedId: line.id,
        source: "Production proof checklist",
        status: "Open",
        notes: "Accept or replace proof before approving this line."
      });
      return false;
    }
    line.reviewStatus = "Approved";
    line.payableStatus = line.sourceType.includes("Contractor") ? "Ready to Pay" : "Job Cost";
    line.billableStatus = "Ready to Bill";
    line.proofStatus = line.proofStatus === "Missing" ? "Accepted Exception" : "Accepted";
  } else if (action === "needs-proof") {
    line.reviewStatus = "Needs Proof";
    line.payableStatus = "Hold";
    line.billableStatus = "Hold";
    line.proofStatus = "Missing";
  } else {
    line.reviewStatus = "Rejected";
    line.payableStatus = "Rejected";
    line.billableStatus = "Rejected";
  }

  const ledgerRow = productionLedgerRows(db).find(row => row.id === line.id) || line;
  if (line.reviewStatus === "Approved") {
    if (line.sourceType.includes("Contractor")) {
      upsert(db, "contractorPayables", {
        id: `PAY-${line.id}`,
        productionLineId: line.id,
        project: line.project,
        contractor: line.submittedBy,
        amount: ledgerRow.submittedAmount || line.submittedAmount || 0,
        status: "Ready to Pay"
      });
    }
    upsert(db, "billingLedger", {
      id: `BILL-${line.id}`,
      productionLineId: line.id,
      project: line.project,
      squanBillableAmount: ledgerRow.squanAmount || ledgerRow.submittedAmount || 0,
      contractorPayableAmount: line.sourceType.includes("Contractor") ? ledgerRow.submittedAmount || 0 : 0,
      inHouseCostAmount: line.sourceType.includes("Tech") ? ledgerRow.submittedAmount || 0 : 0,
      proofStatus: line.proofStatus,
      billingStatus: "Ready to Bill"
    });
  }
  upsert(db, "quantityReconciliation", {
    id: `QTY-${line.id}`,
    productionLineId: line.id,
    project: line.project,
    squanExportQuantity: ledgerRow.squanQuantity || 0,
    jacksonSubmittedQuantity: Number(line.quantity || 0),
    approvedQuantity: line.reviewStatus === "Approved" ? Number(line.quantity || 0) : 0,
    billingQuantity: line.reviewStatus === "Approved" ? Number(line.quantity || 0) : 0,
    varianceQuantity: ledgerRow.varianceQuantity || 0,
    status: line.reviewStatus === "Approved" && !ledgerRow.varianceQuantity ? "Reconciled" : line.reviewStatus
  });
  return true;
}

function billingPackageRows(db) {
  const grouped = new Map();
  (db.billingLedger || [])
    .filter(item => item.billingStatus === "Ready to Bill")
    .forEach(item => {
      const line = (db.productionLines || []).find(row => row.id === item.productionLineId) || {};
      const key = [item.project || line.project || "", item.workedDate || line.workedDate || "", item.code || line.code || ""].join("|");
      const existing = grouped.get(key) || {
        project: item.project || line.project || "",
        workedDate: item.workedDate || line.workedDate || "",
        code: item.code || line.code || "",
        lines: 0,
        quantity: 0,
        squanBillableAmount: 0
      };
      existing.lines += 1;
      existing.quantity += Number(line.quantity || 0);
      existing.squanBillableAmount += Number(item.squanBillableAmount || 0);
      grouped.set(key, existing);
    });
  return [...grouped.values()];
}

function featureLayerForCode(db, code) {
  const price = (db.priceSheetItems || []).find(item => item.code === code) || {};
  const aspect = String(price.aspect || code || "Production");
  if (/splice|fs/i.test(`${aspect} ${code}`)) return "Splicing";
  if (/aerial|overlash|wire|cable/i.test(`${aspect} ${code}`)) return "Aerial";
  if (/underground|bore|trench|conduit/i.test(`${aspect} ${code}`)) return "Underground";
  if (/tech|labor|hour/i.test(`${aspect} ${code}`)) return "Tech Labor";
  return aspect || "Production";
}

function squanMapFeatureRows(db) {
  const explicit = (db.squanMapFeatures || []).map(item => ({ ...item, source: item.source || "SQUAN map feature placeholder" }));
  const imported = (db.squanProductionLines || []).map((line, index) => ({
    id: `FEATURE-${line.id || index}`,
    sourceLineId: line.id,
    project: line.project || line.ntp || "Unassigned",
    ntp: line.ntp || line.project || "Unassigned",
    layerName: line.layerName || featureLayerForCode(db, line.code),
    featureCode: line.code || "",
    description: line.description || line.code || "Imported SQUAN feature",
    quantity: Number(line.quantity || 0),
    uom: line.uom || "Unit",
    status: line.status || "Imported",
    workDate: line.workedDate || "2026-05-19",
    geometryStatus: line.geometry ? "Stored" : "Placeholder",
    source: "SQUAN Daily Export CSV"
  }));
  const byId = new Map();
  [...imported, ...explicit].forEach(item => byId.set(item.id, item));
  return [...byId.values()];
}

function squanMapRollups(db) {
  const grouped = new Map();
  squanMapFeatureRows(db).forEach(feature => {
    const key = [feature.project, feature.layerName, feature.featureCode].join("|");
    const existing = grouped.get(key) || { project: feature.project, layerName: feature.layerName, featureCode: feature.featureCode, quantity: 0, features: 0 };
    existing.quantity += Number(feature.quantity || 0);
    existing.features += 1;
    grouped.set(key, existing);
  });
  return [...grouped.values()];
}

function featureReconciliationRows(db) {
  return squanMapFeatureRows(db).map(feature => {
    const lines = (db.productionLines || []).filter(line => line.sourceFeatureId === feature.id);
    const approved = lines.filter(line => line.reviewStatus === "Approved");
    const billing = (db.billingLedger || []).filter(row => lines.some(line => line.id === row.productionLineId) && row.billingStatus === "Ready to Bill");
    const submittedQuantity = lines.reduce((total, line) => total + Number(line.quantity || 0), 0);
    const approvedQuantity = approved.reduce((total, line) => total + Number(line.quantity || 0), 0);
    const billingQuantity = lines.filter(line => billing.some(row => row.productionLineId === line.id)).reduce((total, line) => total + Number(line.quantity || 0), 0);
    const variance = Number(feature.quantity || 0) - approvedQuantity;
    return {
      feature,
      submittedQuantity,
      approvedQuantity,
      billingQuantity,
      variance,
      status: !lines.length ? "Not Started" : approvedQuantity >= Number(feature.quantity || 0) && Number(feature.quantity || 0) > 0 ? "Reconciled" : approved.length ? "Variance" : "Pending Review"
    };
  });
}

function createDailyFromFeature(db, featureId) {
  const feature = squanMapFeatureRows(db).find(item => item.id === featureId);
  assert(feature, `Missing feature ${featureId}`);
  submitProductionDaily(db, {
    dailyId: "PD-FEATURE-1",
    lineId: "PL-FEATURE-1",
    sourceType: "SQUAN Map Workbench",
    submittedBy: "Operations",
    project: feature.project,
    workedDate: feature.workDate,
    code: feature.featureCode,
    quantity: feature.quantity,
    proofNote: `${feature.layerName} ${feature.featureCode} feature reference.`
  });
  const line = db.productionLines.find(item => item.id === "PL-FEATURE-1");
  line.sourceFeatureId = feature.id;
  return line;
}

function saveManualFeature(db, feature) {
  return upsert(db, "squanMapFeatures", {
    id: feature.id,
    project: feature.project,
    ntp: feature.project,
    layerName: feature.layerName,
    featureCode: feature.featureCode,
    description: feature.description,
    quantity: feature.quantity,
    uom: feature.uom,
    status: feature.status || "Planned",
    source: "Manual SQUAN map feature",
    geometryStatus: "Placeholder"
  });
}

function updateFeatureStatus(db, featureId, status) {
  const feature = squanMapFeatureRows(db).find(item => item.id === featureId);
  assert(feature, `Missing feature ${featureId}`);
  return saveManualFeature(db, { ...feature, status });
}

function updateFeatureStatuses(db, featureIds, status) {
  featureIds.forEach(id => updateFeatureStatus(db, id, status));
}

function createDailyFromFeatures(db, featureIds) {
  const features = featureIds.map(id => squanMapFeatureRows(db).find(item => item.id === id)).filter(Boolean);
  assert(features.length, "No selected features");
  const dailyId = "PD-BATCH-1";
  upsert(db, "productionDailies", {
    id: dailyId,
    project: features[0].project,
    sourceType: "SQUAN Map Workbench",
    submittedBy: "Operations",
    workedDate: features[0].workDate || "2026-05-19",
    status: "Draft",
    sourceFeatureIds: features.map(item => item.id)
  });
  features.forEach((feature, index) => {
    submitProductionDaily(db, {
      dailyId,
      lineId: `PL-BATCH-${index + 1}`,
      sourceType: "SQUAN Map Workbench",
      submittedBy: "Operations",
      project: feature.project,
      workedDate: feature.workDate || "2026-05-19",
      code: feature.featureCode,
      quantity: feature.quantity,
      proofNote: `${feature.layerName} ${feature.featureCode} feature reference.`
    });
    db.productionLines.find(item => item.id === `PL-BATCH-${index + 1}`).sourceFeatureId = feature.id;
    updateFeatureStatus(db, feature.id, "Assigned");
  });
  return db.productionLines.filter(item => item.dailyId === dailyId);
}

function addFeatureProof(db, featureId, note) {
  const feature = squanMapFeatureRows(db).find(item => item.id === featureId);
  assert(feature, `Missing feature ${featureId}`);
  return upsert(db, "fieldEvidence", {
    id: `FE-FEATURE-${featureId}`,
    project: feature.project,
    sourceFeatureId: featureId,
    source: "SQUAN Map Workbench",
    evidenceType: "Feature proof note",
    status: "Submitted",
    notes: note
  });
}

function arcgisReadinessRows(config) {
  return [
    ["Portal URL", config.portalUrl ? "Ready" : "Missing"],
    ["Web map ID", config.webMapId ? "Ready" : "Later"],
    ["Feature service", config.featureServiceUrl ? "Ready" : "Later"],
    ["Layer mapping", config.layerName || config.layerId ? "Ready" : "Later"],
    ["Field mapping", [config.objectIdField, config.globalIdField, config.mapNtpField, config.workCodeField, config.quantityField, config.statusField].every(Boolean) ? "Ready" : "Missing"],
    ["Authentication", /not connected/i.test(config.authMode || "") ? "Later" : "Ready"]
  ];
}

function run() {
  const db = {
    company: {
      arcgis: {
        portalUrl: "https://jactelops.maps.arcgis.com",
        portalDisplayName: "jactelops",
        authMode: "Not connected - configure OAuth or read-only API key later",
        webMapId: "",
        featureServiceUrl: "",
        layerName: "",
        layerId: "",
        objectIdField: "OBJECTID",
        globalIdField: "globalid",
        mapNtpField: "ntp",
        workCodeField: "work_code",
        quantityField: "quantity",
        statusField: "status"
      }
    },
    priceSheetItems: [],
    squanImports: [],
    squanProductionLines: [],
    productionDailies: [],
    productionLines: [],
    contractorPayables: [],
    techWorkEntries: [],
    billingLedger: [],
    quantityReconciliation: [],
    fieldEvidence: [],
    tasks: [],
    squanMapFeatures: []
  };

  const arcgisRows = arcgisReadinessRows(db.company.arcgis);
  assert.strictEqual(arcgisRows.find(([label]) => label === "Portal URL")[1], "Ready");
  assert.strictEqual(arcgisRows.find(([label]) => label === "Authentication")[1], "Later");
  assert.strictEqual(db.company.arcgis.portalDisplayName, "jactelops");

  const priceRows = importPriceSheet(db, [
    "code,description,uom,contractor rate,aspect",
    "BSMI-003,Overlash Fiber,Foot,1.05,Fiber",
    "TS01,Technician labor,Hours,58,Tech"
  ].join("\n"));
  assert.strictEqual(priceRows, 2);
  assert.strictEqual(db.priceSheetItems.find(item => item.code === "BSMI-003").subRate, 1.05);

  const squan = importSquanDaily(db, [
    "ntp,date,code,quantity,amount,description",
    "BSP-MIC-0190,2026-05-19,BSMI-003,100,105,Overlash Fiber"
  ].join("\n"));
  assert.strictEqual(squan.lineCount, 1);
  assert.strictEqual(squan.totalAmount, 105);
  assert.strictEqual(squanMapFeatureRows(db).length, 1);
  assert.strictEqual(squanMapFeatureRows(db)[0].layerName, "Fiber");
  assert.strictEqual(squanMapRollups(db)[0].quantity, 100);
  const featureLine = createDailyFromFeature(db, squanMapFeatureRows(db)[0].id);
  assert.strictEqual(featureLine.sourceFeatureId, "FEATURE-SPL-TEST-1");
  saveManualFeature(db, {
    id: "FEATURE-MANUAL-1",
    project: "BSP-MIC-0190",
    layerName: "Aerial",
    featureCode: "BSMI-003",
    description: "Manual overlash span",
    quantity: 25,
    uom: "Foot",
    status: "Planned"
  });
  updateFeatureStatus(db, "FEATURE-MANUAL-1", "Assigned");
  assert.strictEqual(squanMapFeatureRows(db).find(item => item.id === "FEATURE-MANUAL-1").status, "Assigned");
  updateFeatureStatuses(db, ["FEATURE-SPL-TEST-1", "FEATURE-MANUAL-1"], "Approved");
  assert.strictEqual(squanMapFeatureRows(db).find(item => item.id === "FEATURE-MANUAL-1").status, "Approved");
  addFeatureProof(db, "FEATURE-MANUAL-1", "Manual feature proof before daily creation.");
  assert.strictEqual(db.fieldEvidence.find(item => item.sourceFeatureId === "FEATURE-MANUAL-1").status, "Submitted");
  const batchLines = createDailyFromFeatures(db, ["FEATURE-SPL-TEST-1", "FEATURE-MANUAL-1"]);
  assert.strictEqual(batchLines.length, 2);
  assert.strictEqual(batchLines[1].sourceFeatureId, "FEATURE-MANUAL-1");
  const featureReconBeforeApproval = featureReconciliationRows(db).find(row => row.feature.id === "FEATURE-MANUAL-1");
  assert.strictEqual(featureReconBeforeApproval.submittedQuantity, 25);
  assert.strictEqual(featureReconBeforeApproval.status, "Pending Review");

  submitProductionDaily(db, {
    dailyId: "PD-CON-1",
    lineId: "PL-CON-1",
    sourceType: "Contractor Daily",
    submittedBy: "Jackson Sub Crew",
    project: "BSP-MIC-0190",
    workedDate: "2026-05-19",
    code: "BSMI-003",
    quantity: 100,
    proofNote: "Photo set A and as-built note attached."
  });
  submitProductionDaily(db, {
    dailyId: "PD-CON-2",
    lineId: "PL-CON-2",
    sourceType: "Contractor Daily",
    submittedBy: "Jackson Sub Crew",
    project: "BSP-MIC-0190",
    workedDate: "2026-05-19",
    code: "BSMI-003",
    quantity: 12,
    proofNote: ""
  });
  submitProductionDaily(db, {
    dailyId: "PD-TECH-1",
    lineId: "PL-TECH-1",
    sourceType: "In-House Tech Daily",
    submittedBy: "Marcus Hill",
    project: "BSP-MIC-0190",
    workedDate: "2026-05-19",
    code: "TS01",
    quantity: 4,
    proofNote: "Vehicle 12, field note, and time confirmation."
  });
  submitProductionDaily(db, {
    dailyId: "PD-CON-3",
    lineId: "PL-CON-3",
    sourceType: "Contractor Daily",
    submittedBy: "Jackson Sub Crew",
    project: "BSP-MIC-0190",
    workedDate: "2026-05-19",
    code: "BSMI-003",
    quantity: 6,
    proofNote: "Duplicate unsupported line."
  });

  assert.strictEqual(db.productionDailies.length, 6);
  assert.strictEqual(db.fieldEvidence.length, 7);
  assert.strictEqual(db.techWorkEntries.length, 1);
  assert.strictEqual(productionLedgerRows(db).find(row => row.id === "PL-CON-1").varianceQuantity, 0);

  assert.strictEqual(reviewProductionLine(db, "PL-CON-2", "approve"), false);
  assert.strictEqual(db.tasks.find(item => item.relatedId === "PL-CON-2").status, "Open");
  reviewProductionLine(db, "PL-CON-2", "needs-proof");
  reviewProductionLine(db, "PL-CON-3", "reject");
  assert.strictEqual(reviewProductionLine(db, "PL-CON-1", "approve"), false);
  acceptProof(db, "PL-CON-1");
  acceptProof(db, "PL-TECH-1");
  assert.strictEqual(reviewProductionLine(db, "PL-CON-1", "approve"), true);
  assert.strictEqual(reviewProductionLine(db, "PL-TECH-1", "approve"), true);

  assert.strictEqual(db.productionLines.find(item => item.id === "PL-CON-2").payableStatus, "Hold");
  assert.strictEqual(db.productionLines.find(item => item.id === "PL-CON-3").billableStatus, "Rejected");
  assert.strictEqual(db.contractorPayables.length, 1);
  assert.strictEqual(db.contractorPayables[0].amount, 105);
  assert.strictEqual(db.billingLedger.length, 2);
  assert.strictEqual(db.billingLedger.find(item => item.productionLineId === "PL-CON-1").squanBillableAmount, 105);
  assert.strictEqual(db.billingLedger.find(item => item.productionLineId === "PL-TECH-1").inHouseCostAmount, 232);
  assert.strictEqual(db.quantityReconciliation.find(item => item.productionLineId === "PL-CON-1").status, "Reconciled");
  assert.strictEqual(db.quantityReconciliation.find(item => item.productionLineId === "PL-CON-2").status, "Needs Proof");
  assert.strictEqual(db.quantityReconciliation.find(item => item.productionLineId === "PL-CON-3").status, "Rejected");
  assert.strictEqual(billingPackageRows(db).length, 2);
  assert(featureReconciliationRows(db).some(row => row.feature.id === "FEATURE-SPL-TEST-1" && row.submittedQuantity >= 100));

  console.log("Phase 1 and Phase 2 production workflow test passed.");
  console.log(`Checked ${db.productionLines.length} submitted lines, ${db.contractorPayables.length} payable, ${db.billingLedger.length} billable/job-cost ledger rows.`);
}

run();
