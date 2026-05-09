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
  "dailies",
  "people",
  "equipment",
  "invoices",
  "safety",
  "documents",
  "crews",
  "roles",
  "costCodes",
  "unitPrices",
  "projectUnits",
  "dailyProduction",
  "dailyLabor",
  "dailyEquipment",
  "dailyMaterials",
  "billingReadiness"
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
  const revenue = sum(db.projects, "estimatedRevenue");
  const forecastCost = sum(db.projects, "forecastCost");
  const retainage = sum(db.invoices, "retainage10");
  const openRisks = db.safety.filter(item => item.status !== "Closed").length;
  const blockedDailies = db.dailies.filter(daily => daily.jsa === "Blocked").length;
  return {
    forecastMarginPercent: Math.round(((revenue - forecastCost) / revenue) * 100),
    forecastGrossProfit: revenue - forecastCost,
    retainageOutstanding: retainage,
    openRisks,
    squanScoreEstimate: Math.max(0, 100 - openRisks * 4 - blockedDailies * 3),
    activeProjects: db.projects.length,
    billingWindows: db.projects.filter(project => daysUntil(project.billBy) <= 14).length
  };
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
  const submittedDailies = db.dailies.filter(daily => daily.project === projectId && daily.status === "Submitted");
  const projectUnits = db.projectUnits.filter(unit => unit.project === projectId);
  const billableAmount = projectUnits.reduce((total, unit) => {
    return total + Number(unit.billableQuantity || 0) * Number(unit.unitPrice || 0);
  }, 0);
  const docs = String(project.docs || "").toLowerCase();
  const checks = {
    daily: submittedDailies.length > 0,
    sot: submittedDailies.some(daily => String(daily.output || "").toLowerCase().includes("sot")),
    photos: docs.includes("photos") || submittedDailies.some(daily => String(daily.output || "").toLowerCase().includes("photos")),
    asBuilts: docs.includes("as-built") || docs.includes("asbuilt")
  };
  const missingItems = Object.entries(checks)
    .filter(([, ok]) => !ok)
    .map(([key]) => ({ daily: "submitted daily", sot: "SOT", photos: "photos", asBuilts: "as-builts" }[key]));
  const status = billableAmount <= 0
    ? "Not Ready"
    : missingItems.length
      ? "Blocked"
      : "Ready to Bill";
  const next = {
    id: `BR-${projectId}`,
    project: projectId,
    status,
    billableAmount: Math.round(billableAmount),
    missingItems: missingItems.join(", ") || "None",
    billingDeadline: project.billBy,
    submittedDailies: submittedDailies.length,
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

function appendAudit(db, action, detail) {
  db.auditLog.push({
    id: `AUD-${String(db.auditLog.length + 1).padStart(4, "0")}`,
    at: new Date().toISOString(),
    action,
    detail
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
    const user = db.users.find(item => item.email === body.email) || db.users[0];
    appendAudit(db, "auth.login", { user: user.email });
    writeDb(db);
    return send(res, 200, { user, token: `demo-${user.id}` });
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

    const project = recomputeProject(db, daily.project);
    const readiness = db.billingReadiness.find(item => item.project === daily.project);
    appendAudit(db, "workflow.submitDaily", { dailyId: daily.id, project: daily.project });
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
      dailies: db.dailies,
      people: db.people,
      equipment: db.equipment,
      invoices: db.invoices,
      safety: db.safety,
      documents: db.documents
    });
  }

  if (req.method === "GET" && parts[0] === "api" && parts[1] === "exports" && collections.has(parts[2])) {
    return send(res, 200, csv(db[parts[2]]), "text/csv; charset=utf-8");
  }

  if (parts[0] === "api" && collections.has(parts[1])) {
    const collection = parts[1];
    const id = decodeURIComponent(parts[2] || "");

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
