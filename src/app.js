const today = new Date("2026-05-09T12:00:00");

const seedData = {
  projects: [
    {
      id: "PO-SQ-24018",
      customer: "SQUAN",
      scope: "Underground fiber placement - North Jackson",
      status: "Active",
      crew: "Crew A",
      requiredCerts: "OSHA 10, First Aid/CPR, Trenching",
      estimatedRevenue: 148000,
      actualCost: 93250,
      forecastCost: 121800,
      billed: 82500,
      start: "2026-04-15",
      billBy: "2026-05-24",
      docs: "811 ticket, permit JT-1182, customer authorization, site conditions"
    },
    {
      id: "PO-SQ-24022",
      customer: "SQUAN",
      scope: "Aerial strand and fiber overlash - West route",
      status: "At Risk",
      crew: "Crew B",
      requiredCerts: "OSHA 10, Bucket Truck, Traffic Control",
      estimatedRevenue: 96500,
      actualCost: 69200,
      forecastCost: 91400,
      billed: 48100,
      start: "2026-04-29",
      billBy: "2026-05-18",
      docs: "Pole attachment package, traffic plan, locate tickets"
    },
    {
      id: "PO-SQ-24031",
      customer: "SQUAN",
      scope: "Splicing, testing, and closeout package",
      status: "Submitted",
      crew: "Crew C",
      requiredCerts: "Fiber Splicing, OTDR Calibration",
      estimatedRevenue: 58200,
      actualCost: 18800,
      forecastCost: 42150,
      billed: 0,
      start: "2026-05-13",
      billBy: "2026-06-12",
      docs: "SOT template, test package requirements, as-built standard"
    }
  ],
  dailies: [
    {
      id: "DLY-1007",
      project: "PO-SQ-24018",
      date: "2026-05-08",
      foreman: "Marcus Hill",
      crew: "Crew A",
      jsa: "Complete",
      inspections: "Forms 4, 7, 8 complete",
      locate: "Current",
      production: "1,400 ft fiber placed; 6 splices",
      laborHours: 34,
      equipmentHours: 6.5,
      materials: "SQUAN fiber: 1,480 ft; handholes: 2",
      output: "SQUAN daily, SOT, photos, payroll, inventory posted"
    },
    {
      id: "DLY-1008",
      project: "PO-SQ-24022",
      date: "2026-05-08",
      foreman: "Denise Carter",
      crew: "Crew B",
      jsa: "Blocked",
      inspections: "Bucket dielectric expired",
      locate: "Current",
      production: "No work start allowed",
      laborHours: 2,
      equipmentHours: 0,
      materials: "None",
      output: "Compliance alert sent to Ronald"
    }
  ],
  people: [
    {
      id: "E-014",
      name: "John Miller",
      role: "Lineman",
      crew: "Crew B",
      certs: "OSHA 10, Traffic Control",
      nextExpiration: "2026-05-21",
      compliance: "Expiring",
      backgroundRefresh: "2027-01-18",
      drugTest: "Current",
      workersComp: "7600"
    },
    {
      id: "E-021",
      name: "Marcus Hill",
      role: "Foreman",
      crew: "Crew A",
      certs: "OSHA 30, First Aid/CPR, Trenching",
      nextExpiration: "2026-09-11",
      compliance: "Clear",
      backgroundRefresh: "2028-02-04",
      drugTest: "Current",
      workersComp: "7600"
    },
    {
      id: "E-026",
      name: "Ramon Fields",
      role: "Bucket Operator",
      crew: "Crew B",
      certs: "OSHA 10, Bucket Truck",
      nextExpiration: "2026-05-15",
      compliance: "Blocked",
      backgroundRefresh: "2026-12-02",
      drugTest: "Current",
      workersComp: "7600"
    }
  ],
  equipment: [
    {
      id: "TRK-08",
      asset: "Bucket truck",
      assigned: "Crew B",
      owner: "Jackson Telcom",
      location: "West route",
      inspectionDue: "2026-05-07",
      status: "Unavailable",
      costRate: 68,
      notes: "Annual ANSI A92 dielectric expired"
    },
    {
      id: "SPL-03",
      asset: "Fusion splicer",
      assigned: "Crew C",
      owner: "Jackson Telcom",
      location: "Shop",
      inspectionDue: "2026-08-01",
      status: "Available",
      costRate: 22,
      notes: "Manufacturer calibration current"
    },
    {
      id: "MAT-SQ-FIBER",
      asset: "SQUAN supplied 144ct fiber",
      assigned: "PO-SQ-24018",
      owner: "SQUAN",
      location: "Yard",
      inspectionDue: "N/A",
      status: "Allocated",
      costRate: 0,
      notes: "12,000 ft received; 7,420 ft remaining"
    }
  ],
  invoices: [
    {
      id: "INV-24018-02",
      project: "PO-SQ-24018",
      submitted: "2026-05-03",
      gross: 82500,
      paid90: 74250,
      retainage10: 8250,
      retainageRelease: "2027-05-03",
      status: "Open",
      support: "Dailies, SOT, photos, as-builts attached"
    },
    {
      id: "INV-24022-01",
      project: "PO-SQ-24022",
      submitted: "2026-05-06",
      gross: 48100,
      paid90: 0,
      retainage10: 4810,
      retainageRelease: "2027-05-06",
      status: "Pay-when-paid logged",
      support: "Dailies attached; as-builts pending"
    }
  ],
  safety: [
    {
      id: "RISK-301",
      project: "PO-SQ-24018",
      type: "Near miss",
      date: "2026-05-08",
      severity: "Medium",
      rootCause: "Vehicle entered cone setup; traffic taper too short",
      correctiveAction: "Refresh traffic-control setup and verify Form 12 closure",
      owner: "Ronald Jackson",
      due: "2026-05-13",
      status: "Open"
    },
    {
      id: "RISK-302",
      project: "PO-SQ-24022",
      type: "Missed inspection",
      date: "2026-05-08",
      severity: "High",
      rootCause: "Annual dielectric date not checked before dispatch",
      correctiveAction: "Block TRK-08 and schedule ANSI A92 inspection",
      owner: "Ronald Jackson",
      due: "2026-05-10",
      status: "Open"
    }
  ]
};

const navItems = [
  { key: "dashboard", icon: "DX", label: "Dashboard" },
  { key: "projects", icon: "PO", label: "Project & PO Hub", countKey: "projects" },
  { key: "field", icon: "FD", label: "Field Operations", countKey: "dailies" },
  { key: "people", icon: "ID", label: "People & Compliance", countKey: "people" },
  { key: "equipment", icon: "EQ", label: "Equipment & Materials", countKey: "equipment" },
  { key: "money", icon: "$", label: "Money", countKey: "invoices" },
  { key: "risk", icon: "!", label: "Safety & Risk", countKey: "safety" }
];

const roleConfig = {
  Admin: {
    label: "Admin",
    defaultView: "dashboard",
    views: ["dashboard", "projects", "field", "people", "equipment", "money", "risk"],
    create: ["projects", "dailies", "people", "equipment", "invoices", "safety"],
    description: "Full access across profit, cash, compliance, safety, reporting, and setup."
  },
  Foreman: {
    label: "Foreman",
    defaultView: "field",
    views: ["dashboard", "field", "projects", "equipment", "risk"],
    create: ["dailies", "safety"],
    crew: "Crew A",
    person: "Marcus Hill",
    description: "Assigned POs, field dailies, JSA, inspections, photos, hazards, and closeout."
  },
  Operations: {
    label: "Operations",
    defaultView: "projects",
    views: ["dashboard", "projects", "field", "equipment", "people", "risk"],
    create: ["projects", "dailies", "equipment", "safety"],
    description: "PO schedule, crew assignments, production progress, blockers, and closeout readiness."
  },
  Billing: {
    label: "Billing",
    defaultView: "money",
    views: ["dashboard", "money", "projects", "field"],
    create: ["invoices"],
    description: "Billing readiness, invoices, AR, retainage, pay-when-paid notes, and support packages."
  },
  "Safety/Compliance": {
    label: "Safety/Compliance",
    defaultView: "risk",
    views: ["dashboard", "risk", "people", "equipment", "field", "projects"],
    create: ["safety", "people", "equipment"],
    description: "Certifications, background/MVR/drug-test status, inspections, incidents, and audit exports."
  }
};

const state = {
  view: "dashboard",
  search: "",
  role: "Admin",
  user: loadSession(),
  selectedProjectId: "PO-SQ-24018",
  apiOnline: false,
  data: loadData()
};

function loadSession() {
  const saved = localStorage.getItem("jackson-syncerp-session");
  return saved ? JSON.parse(saved) : null;
}

function saveSession(user) {
  state.user = user;
  state.role = user.role;
  state.view = roleConfig[user.role]?.defaultView || "dashboard";
  localStorage.setItem("jackson-syncerp-session", JSON.stringify(user));
}

function clearSession() {
  state.user = null;
  localStorage.removeItem("jackson-syncerp-session");
}

function loadData() {
  const saved = localStorage.getItem("jackson-syncerp-data");
  return saved ? JSON.parse(saved) : structuredClone(seedData);
}

function persist() {
  localStorage.setItem("jackson-syncerp-data", JSON.stringify(state.data));
}

async function syncFromApi() {
  try {
    const response = await fetch("/api/bootstrap", { cache: "no-store" });
    if (!response.ok) throw new Error("API bootstrap failed");
    const data = await response.json();
    state.data = data;
    state.apiOnline = true;
    persist();
    render();
  } catch (error) {
    state.apiOnline = false;
  }
}

async function saveToApi(collectionKey, record, isNew) {
  if (!state.apiOnline) return;
  const url = isNew ? `/api/${collectionKey}` : `/api/${collectionKey}/${encodeURIComponent(record.id)}`;
  const method = isNew ? "POST" : "PUT";
  try {
    const response = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(record)
    });
    if (!response.ok) throw new Error("API save failed");
  } catch (error) {
    state.apiOnline = false;
  }
}

async function submitDailyWorkflow(payload) {
  if (!state.apiOnline) return;
  const response = await fetch("/api/workflows/submit-daily", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Daily submit failed");
  await syncFromApi();
}

function currency(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(value);
}

function daysUntil(dateText) {
  if (!dateText || dateText === "N/A") return null;
  const target = new Date(`${dateText}T12:00:00`);
  return Math.ceil((target - today) / 86400000);
}

function margin(project) {
  return Math.round(((project.estimatedRevenue - project.forecastCost) / project.estimatedRevenue) * 100);
}

function statusClass(status) {
  const normal = String(status).toLowerCase();
  if (["active", "clear", "complete", "current", "available", "allocated", "paid", "ready to bill"].includes(normal)) return "ok";
  if (["at risk", "expiring", "submitted", "open", "pay-when-paid logged", "not ready"].includes(normal)) return "warn";
  if (["blocked", "unavailable", "past due"].includes(normal)) return "bad";
  return "info";
}

function matches(record) {
  if (!state.search.trim()) return true;
  return Object.values(record).join(" ").toLowerCase().includes(state.search.trim().toLowerCase());
}

function render() {
  document.getElementById("app").innerHTML = appTemplate();
  bindEvents();
}

function appTemplate() {
  if (state.user && !roleConfig[state.user.role]) {
    clearSession();
  }
  if (!state.user) return loginTemplate();
  ensureAllowedView();
  const allowedNav = navItems.filter(item => canView(item.key));
  const canCreateRecord = canCreate(collectionForView());
  return `
    <div class="app-shell">
      <aside class="sidebar" id="sidebar">
        <div class="brand">
          <div class="brand-mark">JT</div>
          <div>
            <strong>Jackson Telcom ERP</strong>
            <span>SQUAN operating system</span>
          </div>
        </div>
        <nav class="nav">
          ${allowedNav.map(item => `
            <button class="${state.view === item.key ? "active" : ""}" data-view="${item.key}">
              <span>${item.icon}</span>
              <span>${item.label}</span>
              <span class="count">${item.countKey ? scopedRows(item.countKey).length : ""}</span>
            </button>
          `).join("")}
        </nav>
      </aside>
      <main class="main">
        <header class="topbar">
          <button class="icon-btn mobile-menu" id="mobileMenu" title="Open navigation">☰</button>
          <div class="title-area">
            <h1>${pageTitle()}</h1>
            <p>${pageSubtitle()}</p>
          </div>
          <div class="toolbar">
            <span class="api-pill ${state.apiOnline ? "online" : "offline"}">${state.apiOnline ? "Server" : "Local"}</span>
            <div class="user-chip">
              <strong>${state.user.name}</strong>
              <span>${state.user.role}</span>
            </div>
            <input class="search" id="search" type="search" value="${state.search}" placeholder="Search ERP records">
            <button class="secondary-btn" id="resetData">Reset demo data</button>
            ${canCreateRecord ? `<button class="primary-btn" id="newRecord">${newButtonLabel()}</button>` : ""}
            <button class="secondary-btn" id="signOut">Sign out</button>
          </div>
        </header>
        <section class="content">${renderView()}</section>
      </main>
    </div>
    <div class="drawer-backdrop" id="drawerBackdrop"></div>
    <aside class="drawer" id="drawer" aria-hidden="true"></aside>
  `;
}

function loginTemplate() {
  const users = state.data.users || [
    { id: "U-001", name: "Ronald Jackson", email: "ronald@jacksontelcom.example", role: "Admin" },
    { id: "U-002", name: "Marcus Hill", email: "marcus@jacksontelcom.example", role: "Foreman" },
    { id: "U-003", name: "Operations Coordinator", email: "ops@jacksontelcom.example", role: "Operations" },
    { id: "U-004", name: "Office Billing", email: "billing@jacksontelcom.example", role: "Billing" },
    { id: "U-005", name: "Safety Compliance", email: "safety@jacksontelcom.example", role: "Safety/Compliance" }
  ];
  return `
    <main class="login-screen">
      <section class="login-panel">
        <div class="login-copy">
          <div class="brand-mark">JT</div>
          <span class="eyebrow">Jackson Telcom ERP</span>
          <h1>Sign in to your workspace</h1>
          <p>Each role opens to the work that matters most: field dailies, PO blockers, billing readiness, compliance risk, or the owner dashboard.</p>
        </div>
        <form class="login-form" id="loginForm">
          <div class="field">
            <label for="loginEmail">Email</label>
            <input id="loginEmail" type="email" value="${users[0]?.email || ""}">
          </div>
          <div class="field">
            <label for="loginPassword">Password</label>
            <input id="loginPassword" type="password" value="demo">
          </div>
          <button class="primary-btn" type="submit">Sign in</button>
        </form>
        <div class="demo-users">
          <h2>Demo workspaces</h2>
          ${users.map(user => `
            <button class="demo-user" data-login-email="${user.email}">
              <strong>${user.name}</strong>
              <span>${user.role}</span>
              <small>${workspaceSummary(user.role)}</small>
            </button>
          `).join("")}
        </div>
      </section>
    </main>
  `;
}

function workspaceSummary(role) {
  return {
    Admin: "Executive exceptions, profit, cash, compliance, and audit exports",
    Foreman: "Today’s field daily, JSA, inspections, production, and submit",
    Operations: "Active POs, crew assignment, production progress, and blockers",
    Billing: "Billing readiness, missing support, AR, retainage, and disputes",
    "Safety/Compliance": "Cert expirations, incidents, inspections, Form 12, and SQUAN score"
  }[role] || "Role workspace";
}

function canView(view) {
  return roleConfig[state.role].views.includes(view);
}

function canCreate(collectionKey) {
  return roleConfig[state.role].create.includes(collectionKey);
}

function ensureAllowedView() {
  if (!canView(state.view)) {
    state.view = roleConfig[state.role].defaultView;
    state.search = "";
  }
}

function scopedRows(collectionKey) {
  const rows = state.data[collectionKey] || [];
  if (state.role === "Admin") return rows;
  if (state.role === "Foreman") return scopeForeman(collectionKey, rows);
  if (state.role === "Billing") return scopeBilling(collectionKey, rows);
  if (state.role === "Safety/Compliance") return scopeSafety(collectionKey, rows);
  return rows;
}

function scopeForeman(collectionKey, rows) {
  const role = roleConfig.Foreman;
  if (collectionKey === "projects") return rows.filter(row => row.crew === role.crew);
  if (collectionKey === "dailies") return rows.filter(row => row.crew === role.crew || row.foreman === role.person);
  if (collectionKey === "equipment") return rows.filter(row => row.assigned === role.crew || row.assigned === "PO-SQ-24018");
  if (collectionKey === "safety") return rows.filter(row => row.project === "PO-SQ-24018");
  return [];
}

function scopeBilling(collectionKey, rows) {
  if (collectionKey === "projects") return rows;
  if (collectionKey === "dailies") return rows;
  if (collectionKey === "invoices") return rows;
  if (collectionKey === "billingReadiness") return rows;
  if (["projectUnits", "dailyProduction", "dailyLabor", "dailyEquipment", "dailyMaterials"].includes(collectionKey)) return rows;
  return [];
}

function scopeSafety(collectionKey, rows) {
  if (["projects", "dailies", "people", "equipment", "safety"].includes(collectionKey)) return rows;
  return [];
}

function pageTitle() {
  return {
    dashboard: "Single Source of Truth",
    projects: "Project & PO Hub",
    field: "Field Operations",
    people: "People & Compliance",
    equipment: "Equipment & Materials",
    money: "Money: Accounting, Invoicing, Cash Flow",
    risk: "Safety, Quality, and Risk"
  }[state.view];
}

function pageSubtitle() {
  return {
    dashboard: "From SQUAN PO intake to field daily, invoice support, retainage tracking, and audit readiness.",
    projects: "Every SQUAN PO is the parent record for scope, budget, documents, crews, billing, and margin.",
    field: "One foreman daily drives JSA, inspections, production, payroll, inventory, SOT, photos, and SQUAN reports.",
    people: "Certification, background check, drug test, HSE acknowledgment, and subcontractor compliance controls.",
    equipment: "Availability, inspection calendars, SQUAN-owned material tracking, and equipment cost allocation.",
    money: "Invoice completeness, 30-day billing window, 90/10 retainage, AR risk, and 13-week cash visibility.",
    risk: "Incidents, near misses, 5 Whys, Form 12 corrective actions, audit metrics, and SQUAN score protection."
  }[state.view];
}

function newButtonLabel() {
  return {
    dashboard: "New PO",
    projects: "New PO",
    field: "New daily",
    people: "New person",
    equipment: "New asset",
    money: "New invoice",
    risk: "New risk event"
  }[state.view];
}

function renderView() {
  if (state.view === "dashboard") return renderDashboard();
  if (state.view === "projects") return renderProjectHub();
  if (state.view === "field") return renderField();
  if (state.view === "money") return renderMoney();
  if (state.view === "risk") return renderRisk();
  return renderTablePanel(tableConfig()[state.view]);
}

function renderDashboard() {
  const projects = scopedRows("projects");
  const invoices = scopedRows("invoices");
  const safety = scopedRows("safety");
  const dailies = scopedRows("dailies");
  const revenue = sum(projects, "estimatedRevenue");
  const forecastCost = sum(projects, "forecastCost");
  const retainage = sum(invoices, "retainage10");
  const activeRisks = safety.filter(item => item.status !== "Closed").length;
  const blockedDailies = dailies.filter(daily => daily.jsa === "Blocked").length;
  const squanScore = Math.max(0, 100 - activeRisks * 4 - blockedDailies * 3);

  return `
    ${renderRoleLanding()}
    <section class="metrics">
      ${metric("Forecast margin", `${Math.round(((revenue - forecastCost) / revenue) * 100)}%`, `${currency(revenue - forecastCost)} forecast gross profit`)}
      ${metric("Retainage outstanding", currency(retainage), "Tracked by 12-month release date")}
      ${metric("SQUAN score estimate", `${squanScore} pts`, "Protects A-rating and payment timing")}
      ${metric("Open risk events", activeRisks, "Near misses, inspections, chargebacks")}
    </section>
    <section class="grid">
      ${renderProjectCards()}
      <div class="panel">
        <div class="panel-header">
          <h2>Today at 4:05 PM</h2>
          <span>Auto outputs from field closeout</span>
        </div>
        <div class="timeline">
          ${[
            "SQUAN Daily Production Report generated",
            "SOT submitted and archived to project folder",
            "Crew timesheet finalized for payroll",
            "SQUAN material consumption deducted",
            "PO production and margin recalculated",
            "Near miss routed to Safety & Risk with RCA owner"
          ].map(text => `<div class="timeline-item"><span></span><p>${text}</p></div>`).join("")}
        </div>
      </div>
    </section>
  `;
}

function renderRoleLanding() {
  if (state.role === "Foreman") {
    const daily = scopedRows("dailies")[0];
    if (!daily) return `
      <section class="role-panel">
        <div>
          <span class="eyebrow">Foreman start screen</span>
          <h2>No assigned dailies</h2>
          <p>There are no field dailies assigned to this foreman role yet.</p>
        </div>
        <button class="primary-btn" data-view-shortcut="field">Open Field Daily</button>
      </section>
    `;
    const project = state.data.projects.find(item => item.id === daily.project);
    return `
      <section class="role-panel">
        <div>
          <span class="eyebrow">Foreman start screen</span>
          <h2>${project.id} - ${project.scope}</h2>
          <p>${daily.crew} has a clear JSA, current 811, ${daily.laborHours} labor hours logged, and closeout outputs ready for review.</p>
        </div>
        <button class="primary-btn" data-view-shortcut="field">Open Field Daily</button>
      </section>
    `;
  }

  if (state.role === "Billing") {
    const dueSoon = scopedRows("projects").filter(project => {
      const days = daysUntil(project.billBy);
      return days !== null && days <= 14;
    }).length;
    return `
      <section class="role-panel">
        <div>
          <span class="eyebrow">Office billing queue</span>
          <h2>${dueSoon} PO billing windows need attention</h2>
          <p>Invoice packages are organized around dailies, SOT forms, as-builts, retainage, and pay-when-paid notes.</p>
        </div>
        <button class="primary-btn" data-view-shortcut="money">Open Money</button>
      </section>
    `;
  }

  if (state.role === "Operations") {
    return `
      <section class="role-panel">
        <div>
          <span class="eyebrow">Operations queue</span>
          <h2>PO schedule, crews, production, and blockers</h2>
          <p>${roleConfig.Operations.description}</p>
        </div>
        <button class="primary-btn" data-view-shortcut="projects">Open PO Hub</button>
      </section>
    `;
  }

  if (state.role === "Safety/Compliance") {
    return `
      <section class="role-panel">
        <div>
          <span class="eyebrow">Safety and compliance queue</span>
          <h2>Certs, inspections, incidents, and audit readiness</h2>
          <p>${roleConfig["Safety/Compliance"].description}</p>
        </div>
        <button class="primary-btn" data-view-shortcut="risk">Open Safety & Risk</button>
      </section>
    `;
  }

  return `
    <section class="role-panel">
      <div>
        <span class="eyebrow">Ronald command view</span>
        <h2>Profit, cash, compliance, and SQUAN score in one pass</h2>
        <p>Use this view for Sunday-night operating review across active POs, risk events, cert expirations, and retainage.</p>
      </div>
      <button class="primary-btn" data-view-shortcut="projects">Open PO Hub</button>
    </section>
  `;
}

function renderProjectHub() {
  const rows = scopedRows("projects").filter(matches);
  const selected = rows.find(project => project.id === state.selectedProjectId) || rows[0] || state.data.projects[0];
  if (selected && selected.id !== state.selectedProjectId) state.selectedProjectId = selected.id;

  return `
    <section class="project-hub">
      <div class="panel project-list-panel">
        <div class="panel-header">
          <h2>SQUAN POs</h2>
          <span>${rows.length} shown</span>
        </div>
        <div class="project-list">
          ${rows.map(project => `
            <button class="project-row ${project.id === selected.id ? "active" : ""}" data-project-id="${project.id}">
              <strong>${project.id}</strong>
              <span>${project.scope}</span>
              <small>${project.crew} - ${margin(project)}% margin - bill by ${project.billBy}</small>
            </button>
          `).join("") || `<div class="empty">No projects match your search.</div>`}
        </div>
      </div>
      ${renderProjectDetail(selected)}
    </section>
  `;
}

function renderProjectDetail(project) {
  const dailies = scopedRows("dailies").filter(daily => daily.project === project.id);
  const invoices = scopedRows("invoices").filter(invoice => invoice.project === project.id);
  const risk = scopedRows("safety").filter(item => item.project === project.id);
  const units = scopedRows("projectUnits").filter(unit => unit.project === project.id);
  const readiness = scopedRows("billingReadiness").find(item => item.project === project.id);
  return `
    <div class="panel project-detail">
      <div class="panel-header">
        <h2>${project.id}</h2>
        <span class="status ${statusClass(project.status)}">${project.status}</span>
      </div>
      <div class="detail-body">
        <div>
          <span class="eyebrow">Scope</span>
          <p>${project.scope}</p>
        </div>
        <div class="profit-grid">
          <span>Revenue<strong>${currency(project.estimatedRevenue)}</strong></span>
          <span>Actual cost<strong>${currency(project.actualCost)}</strong></span>
          <span>Forecast<strong>${currency(project.forecastCost)}</strong></span>
          <span>Margin<strong>${margin(project)}%</strong></span>
        </div>
        <div class="detail-grid">
          <span>Crew<strong>${project.crew}</strong></span>
          <span>Required certs<strong>${project.requiredCerts}</strong></span>
          <span>Billing deadline<strong>${formatDateRisk(project.billBy)}</strong></span>
          <span>Document control<strong>${project.docs}</strong></span>
        </div>
        <div class="linked-records">
          ${linkedCount("Field dailies", dailies.length)}
          ${linkedCount("Invoices", invoices.length)}
          ${linkedCount("Risk events", risk.length)}
        </div>
        <div class="section-block">
          <div class="section-heading">
            <h3>Production and billing readiness</h3>
            ${readiness ? `<span class="status ${statusClass(readiness.status)}">${readiness.status}</span>` : ""}
          </div>
          <div class="unit-list">
            ${units.map(unit => `
              <div class="unit-row">
                <strong>${unit.description}</strong>
                <span>${Number(unit.completedQuantity || 0).toLocaleString()} / ${Number(unit.contractQuantity || 0).toLocaleString()} ${unit.unitCode}</span>
                <small>${currency(Number(unit.billableQuantity || 0) * Number(unit.unitPrice || 0))} billable</small>
              </div>
            `).join("") || `<div class="empty">No unit-price lines have been added.</div>`}
          </div>
          ${readiness ? `<p class="readiness-note">Missing: ${readiness.missingItems}. Deadline: ${readiness.billingDeadline}. Billable: ${currency(readiness.billableAmount)}.</p>` : ""}
        </div>
      </div>
    </div>
  `;
}

function linkedCount(label, value) {
  return `<div><strong>${value}</strong><span>${label}</span></div>`;
}

function renderProjectCards() {
  const rows = scopedRows("projects").filter(matches);
  return `
    <div class="panel">
      <div class="panel-header">
        <h2>Project profitability</h2>
        <span>${rows.length} active PO records</span>
      </div>
      <div class="records project-records">
        ${rows.map(project => `
          <article class="record-card">
            <div class="card-topline">
              <h3>${project.id}</h3>
              <span class="status ${statusClass(project.status)}">${project.status}</span>
            </div>
            <p>${project.scope}</p>
            <div class="profit-grid">
              <span>Revenue<strong>${currency(project.estimatedRevenue)}</strong></span>
              <span>Actual cost<strong>${currency(project.actualCost)}</strong></span>
              <span>Forecast cost<strong>${currency(project.forecastCost)}</strong></span>
              <span>Margin<strong>${margin(project)}%</strong></span>
            </div>
            <small>${project.crew} - bill by ${project.billBy}</small>
          </article>
        `).join("") || `<div class="empty">No projects match your search.</div>`}
      </div>
    </div>
  `;
}

function renderField() {
  return `
    <section class="field-layout">
      ${renderMobileDailyWizard()}
      <div class="panel workflow-panel">
        <div class="panel-header">
          <h2>Foreman daily heartbeat</h2>
          <span>Pre-job, during work, closeout</span>
        </div>
        <div class="workflow">
          ${workflowStep("1", "Pre-job gate", "Assigned PO, JSA, crew signatures, PPE, Forms 4/6/7/8, and 811 ticket must be green before work starts.")}
          ${workflowStep("2", "During work", "GPS/time-stamped photos, hazards, near misses, material movement, and field notes are attached to the PO.")}
          ${workflowStep("3", "End of shift", "Production units, labor hours, equipment hours, SOT, and materials consumed generate every downstream record.")}
        </div>
      </div>
      ${renderTablePanel(tableConfig().field)}
    </section>
  `;
}

function renderMobileDailyWizard() {
  const daily = scopedRows("dailies")[0] || state.data.dailies[0];
  const project = scopedRows("projects").find(item => item.id === daily.project) || scopedRows("projects")[0] || state.data.projects[0];
  const unitOptions = scopedRows("projectUnits").filter(unit => unit.project === project.id);
  const equipmentOptions = scopedRows("equipment");
  const defaultUnit = unitOptions[0] || {};
  const defaultEquipment = equipmentOptions[0] || {};
  return `
    <div class="panel daily-wizard">
      <div class="panel-header">
        <h2>Today's Field Daily</h2>
        <span>${project.id}</span>
      </div>
      <div class="wizard-steps">
        ${dailyGate("Pre-job", daily.jsa, ["JSA signed", "PPE Form 7", "811 current", "Crew certs checked"])}
        ${dailyGate("Work log", "In progress", ["Add progress photo", "Log hazard", "Track material", "Capture GPS note"])}
        ${dailyGate("Closeout", "Ready", ["Enter production", "Finalize hours", "Generate SOT", "Submit SQUAN daily"])}
      </div>
      <div class="daily-submit-form">
        <div class="field">
          <label for="dailyId">Daily ID</label>
          <input id="dailyId" value="DLY-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}">
        </div>
        <div class="field">
          <label for="dailyProject">PO</label>
          <select id="dailyProject">
            ${scopedRows("projects").map(item => `<option value="${item.id}" ${item.id === project.id ? "selected" : ""}>${item.id}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="dailyUnit">Production unit</label>
          <select id="dailyUnit">
            ${unitOptions.map(unit => `<option value="${unit.unitCode}">${unit.description}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="dailyQuantity">Quantity complete</label>
          <input id="dailyQuantity" type="number" value="100">
        </div>
        <div class="field">
          <label for="dailyLaborHours">Labor hours</label>
          <input id="dailyLaborHours" type="number" value="8" step="0.25">
        </div>
        <div class="field">
          <label for="dailyLaborRate">Labor cost rate</label>
          <input id="dailyLaborRate" type="number" value="38" step="0.01">
        </div>
        <div class="field">
          <label for="dailyEquipment">Equipment</label>
          <select id="dailyEquipment">
            ${equipmentOptions.map(item => `<option value="${item.id}" data-rate="${item.costRate || 0}">${item.id} - ${item.asset}</option>`).join("")}
          </select>
        </div>
        <div class="field">
          <label for="dailyEquipmentHours">Equipment hours</label>
          <input id="dailyEquipmentHours" type="number" value="2" step="0.25">
        </div>
        <div class="field">
          <label for="dailyMaterialQty">SQUAN material quantity</label>
          <input id="dailyMaterialQty" type="number" value="100">
        </div>
        <div class="field">
          <label for="dailyNotes">Notes</label>
          <input id="dailyNotes" value="${defaultUnit.description || "Production entry"}">
        </div>
      </div>
      <div class="mobile-actionbar">
        <button class="secondary-btn">Save Draft</button>
        <button class="secondary-btn">Add Photo</button>
        <button class="primary-btn" id="submitDaily">Submit Daily</button>
      </div>
    </div>
  `;
}

function dailyGate(title, status, items) {
  return `
    <article class="wizard-card">
      <div class="card-topline">
        <h3>${title}</h3>
        <span class="status ${statusClass(status)}">${status}</span>
      </div>
      <div class="check-grid">
        ${items.map(item => `<label><input type="checkbox" checked> ${item}</label>`).join("")}
      </div>
    </article>
  `;
}

function workflowStep(number, title, body) {
  return `
    <article class="workflow-step">
      <span>${number}</span>
      <div>
        <h3>${title}</h3>
        <p>${body}</p>
      </div>
    </article>
  `;
}

function renderMoney() {
  const invoices = scopedRows("invoices").filter(matches);
  const gross = sum(invoices, "gross");
  const paid = sum(invoices, "paid90");
  const retainage = sum(invoices, "retainage10");
  return `
    <section class="metrics">
      ${metric("Gross invoiced", currency(gross), "Requires dailies and as-builts")}
      ${metric("90% received", currency(paid), "Cash applied against AR")}
      ${metric("10% retainage", currency(retainage), "Release dates tracked")}
      ${metric("13-week risk", currency(gross - paid), "Open AR and pay-when-paid exposure")}
    </section>
    ${renderBillingReadinessQueue()}
    ${renderTablePanel(tableConfig().money)}
  `;
}

function renderBillingReadinessQueue() {
  const rows = scopedRows("billingReadiness").filter(matches);
  return `
    <div class="panel readiness-panel">
      <div class="panel-header">
        <h2>Billing readiness queue</h2>
        <span>${rows.length} POs</span>
      </div>
      <div class="readiness-grid">
        ${rows.map(item => `
          <article class="readiness-card">
            <div class="card-topline">
              <h3>${item.project}</h3>
              <span class="status ${statusClass(item.status)}">${item.status}</span>
            </div>
            <div class="profit-grid">
              <span>Billable<strong>${currency(item.billableAmount)}</strong></span>
              <span>Dailies<strong>${item.submittedDailies}</strong></span>
              <span>Deadline<strong>${item.billingDeadline}</strong></span>
              <span>Missing<strong>${item.missingItems}</strong></span>
            </div>
          </article>
        `).join("") || `<div class="empty">No billing readiness records match your search.</div>`}
      </div>
    </div>
  `;
}

function renderRisk() {
  const hours = sum(scopedRows("dailies"), "laborHours");
  const open = scopedRows("safety").filter(item => item.status !== "Closed").length;
  return `
    <section class="metrics">
      ${metric("TRIR input hours", hours, "Fed by field daily labor")}
      ${metric("Open Form 12 items", open, "Corrective actions not closed")}
      ${metric("DART", "0.00", "Prototype metric")}
      ${metric("MVIFR", "0.00", "Prototype metric")}
    </section>
    ${renderTablePanel(tableConfig().risk)}
  `;
}

function metric(label, value, note) {
  return `
    <div class="metric">
      <span>${label}</span>
      <strong>${value}</strong>
      <small>${note}</small>
    </div>
  `;
}

function sum(rows, key) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function tableConfig() {
  return {
    projects: {
      key: "projects",
      title: "SQUAN PO records",
      columns: [
        { key: "id", label: "PO" },
        { key: "scope", label: "Scope" },
        { key: "crew", label: "Crew" },
        { key: "requiredCerts", label: "Required certs" },
        { key: "estimatedRevenue", label: "Revenue", type: "money" },
        { key: "forecastCost", label: "Forecast cost", type: "money" },
        { key: "status", label: "Status", type: "status" },
        { key: "billBy", label: "Bill by" }
      ]
    },
    field: {
      key: "dailies",
      title: "Field dailies",
      columns: [
        { key: "id", label: "Daily" },
        { key: "project", label: "PO" },
        { key: "foreman", label: "Foreman" },
        { key: "jsa", label: "JSA", type: "status" },
        { key: "inspections", label: "Inspections" },
        { key: "production", label: "Production" },
        { key: "laborHours", label: "Labor hrs" },
        { key: "output", label: "Auto outputs" }
      ]
    },
    people: {
      key: "people",
      title: "People compliance ledger",
      columns: [
        { key: "id", label: "ID" },
        { key: "name", label: "Name" },
        { key: "role", label: "Role" },
        { key: "crew", label: "Crew" },
        { key: "certs", label: "Certifications" },
        { key: "nextExpiration", label: "Next expiration", type: "dateRisk" },
        { key: "compliance", label: "Compliance", type: "status" },
        { key: "backgroundRefresh", label: "Background refresh" }
      ]
    },
    equipment: {
      key: "equipment",
      title: "Equipment and material controls",
      columns: [
        { key: "id", label: "Asset" },
        { key: "asset", label: "Description" },
        { key: "assigned", label: "Assigned" },
        { key: "owner", label: "Owner" },
        { key: "inspectionDue", label: "Inspection due", type: "dateRisk" },
        { key: "status", label: "Status", type: "status" },
        { key: "notes", label: "Notes" }
      ]
    },
    money: {
      key: "invoices",
      title: "Invoices, retainage, and AR",
      columns: [
        { key: "id", label: "Invoice" },
        { key: "project", label: "PO" },
        { key: "submitted", label: "Submitted" },
        { key: "gross", label: "Gross", type: "money" },
        { key: "paid90", label: "90% paid", type: "money" },
        { key: "retainage10", label: "10% retainage", type: "money" },
        { key: "retainageRelease", label: "Release" },
        { key: "status", label: "Status", type: "status" },
        { key: "support", label: "Support package" }
      ]
    },
    risk: {
      key: "safety",
      title: "Safety, quality, and risk log",
      columns: [
        { key: "id", label: "Event" },
        { key: "project", label: "PO" },
        { key: "type", label: "Type" },
        { key: "severity", label: "Severity", type: "severity" },
        { key: "rootCause", label: "5 Whys root cause" },
        { key: "correctiveAction", label: "Form 12 action" },
        { key: "owner", label: "Owner" },
        { key: "due", label: "Due", type: "dateRisk" },
        { key: "status", label: "Status", type: "status" }
      ]
    }
  };
}

function renderTablePanel(config) {
  const rows = scopedRows(config.key).filter(matches);
  return `
    <div class="panel">
      <div class="panel-header">
        <h2>${config.title}</h2>
        <span>${rows.length} shown</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>${config.columns.map(column => `<th>${column.label}</th>`).join("")}<th>Action</th></tr>
          </thead>
          <tbody>
            ${rows.map(row => `
              <tr>
                ${config.columns.map(column => `<td>${formatCell(row, column)}</td>`).join("")}
                <td>${canCreate(config.key) ? `<button class="secondary-btn" data-edit="${config.key}" data-index="${state.data[config.key].indexOf(row)}">Edit</button>` : `<span class="readonly">View only</span>`}</td>
              </tr>
            `).join("") || `<tr><td colspan="${config.columns.length + 1}" class="empty">No records match your search.</td></tr>`}
          </tbody>
        </table>
      </div>
      <div class="mobile-records">
        ${rows.map(row => renderMobileRecord(row, config)).join("") || `<div class="empty">No records match your search.</div>`}
      </div>
    </div>
  `;
}

function renderMobileRecord(row, config) {
  const titleColumn = config.columns[0];
  const subtitleColumn = config.columns[1] || config.columns[0];
  return `
    <article class="mobile-record-card">
      <div class="card-topline">
        <h3>${formatCell(row, titleColumn)}</h3>
        ${canCreate(config.key) ? `<button class="secondary-btn" data-edit="${config.key}" data-index="${state.data[config.key].indexOf(row)}">Edit</button>` : `<span class="readonly">View only</span>`}
      </div>
      <p>${formatCell(row, subtitleColumn)}</p>
      <dl>
        ${config.columns.slice(2, 7).map(column => `
          <div>
            <dt>${column.label}</dt>
            <dd>${formatCell(row, column)}</dd>
          </div>
        `).join("")}
      </dl>
    </article>
  `;
}

function formatCell(row, column) {
  const value = row[column.key];
  if (column.type === "money") return currency(Number(value || 0));
  if (column.type === "status") return `<span class="status ${statusClass(value)}">${value}</span>`;
  if (column.type === "severity") return `<span class="priority ${String(value).toLowerCase()}">${value}</span>`;
  if (column.type === "dateRisk") return formatDateRisk(value);
  return value;
}

function formatDateRisk(value) {
  const days = daysUntil(value);
  if (days === null) return value;
  const cls = days < 0 ? "bad" : days <= 14 ? "bad" : days <= 30 ? "warn" : "ok";
  return `<span class="status ${cls}">${value}</span>`;
}

function collectionForView() {
  return {
    dashboard: "projects",
    projects: "projects",
    field: "dailies",
    people: "people",
    equipment: "equipment",
    money: "invoices",
    risk: "safety"
  }[state.view];
}

function openDrawer(collectionKey, index = null) {
  const config = Object.values(tableConfig()).find(item => item.key === collectionKey);
  const record = index === null ? createBlankRecord(collectionKey) : state.data[collectionKey][index];
  const drawer = document.getElementById("drawer");
  const backdrop = document.getElementById("drawerBackdrop");

  drawer.innerHTML = `
    <header>
      <h2>${index === null ? "Create" : "Edit"} ${config.title}</h2>
      <button class="icon-btn" id="closeDrawer" title="Close">×</button>
    </header>
    <form id="recordForm">
      <div class="fields">
        ${Object.entries(record).map(([key, value]) => `
          <div class="field ${String(value).length > 34 ? "full" : ""}">
            <label for="${key}">${labelize(key)}</label>
            ${String(value).length > 70 ? `<textarea id="${key}" name="${key}">${value}</textarea>` : `<input id="${key}" name="${key}" value="${value}">`}
          </div>
        `).join("")}
      </div>
    </form>
    <footer>
      <button class="secondary-btn" id="cancelDrawer">Cancel</button>
      <button class="primary-btn" id="saveRecord">Save</button>
    </footer>
  `;

  drawer.classList.add("open");
  backdrop.classList.add("open");
  drawer.setAttribute("aria-hidden", "false");

  document.getElementById("closeDrawer").addEventListener("click", closeDrawer);
  document.getElementById("cancelDrawer").addEventListener("click", closeDrawer);
  document.getElementById("saveRecord").addEventListener("click", () => saveRecord(collectionKey, index));
}

async function saveRecord(collectionKey, index) {
  const form = new FormData(document.getElementById("recordForm"));
  const numeric = ["estimatedRevenue", "actualCost", "forecastCost", "billed", "laborHours", "equipmentHours", "costRate", "gross", "paid90", "retainage10"];
  const nextRecord = {};
  for (const [key, value] of form.entries()) {
    nextRecord[key] = numeric.includes(key) ? Number(value) : value;
  }
  if (index === null) {
    state.data[collectionKey].push(nextRecord);
  } else {
    state.data[collectionKey][index] = nextRecord;
  }
  persist();
  await saveToApi(collectionKey, nextRecord, index === null);
  closeDrawer();
  render();
}

function createBlankRecord(collectionKey) {
  const examples = state.data[collectionKey][0] || {};
  return Object.fromEntries(Object.keys(examples).map(key => [key, ""]));
}

function labelize(key) {
  return key.replace(/([A-Z])/g, " $1").replace(/^./, match => match.toUpperCase());
}

function closeDrawer() {
  document.getElementById("drawer").classList.remove("open");
  document.getElementById("drawerBackdrop").classList.remove("open");
  document.getElementById("drawer").setAttribute("aria-hidden", "true");
}

function bindEvents() {
  document.querySelectorAll("[data-login-email]").forEach(button => {
    button.addEventListener("click", () => loginByEmail(button.dataset.loginEmail));
  });

  const loginForm = document.getElementById("loginForm");
  if (loginForm) {
    loginForm.addEventListener("submit", event => {
      event.preventDefault();
      loginByEmail(document.getElementById("loginEmail").value);
    });
  }

  if (!state.user) return;

  document.querySelectorAll("[data-view]").forEach(button => {
    button.addEventListener("click", () => {
      state.view = button.dataset.view;
      state.search = "";
      render();
    });
  });

  document.querySelectorAll("[data-edit]").forEach(button => {
    button.addEventListener("click", () => openDrawer(button.dataset.edit, Number(button.dataset.index)));
  });

  document.querySelectorAll("[data-project-id]").forEach(button => {
    button.addEventListener("click", () => {
      state.selectedProjectId = button.dataset.projectId;
      render();
    });
  });

  document.querySelectorAll("[data-view-shortcut]").forEach(button => {
    button.addEventListener("click", () => {
      state.view = button.dataset.viewShortcut;
      state.search = "";
      render();
    });
  });

  document.getElementById("search").addEventListener("input", event => {
    state.search = event.target.value;
    render();
  });

  const newRecord = document.getElementById("newRecord");
  if (newRecord) newRecord.addEventListener("click", () => openDrawer(collectionForView()));
  const submitDaily = document.getElementById("submitDaily");
  if (submitDaily) submitDaily.addEventListener("click", handleDailySubmit);
  document.getElementById("signOut").addEventListener("click", () => {
    clearSession();
    render();
  });
  document.getElementById("resetData").addEventListener("click", () => {
    state.data = structuredClone(seedData);
    state.apiOnline = false;
    persist();
    render();
  });

  document.getElementById("drawerBackdrop").addEventListener("click", closeDrawer);
  document.getElementById("mobileMenu").addEventListener("click", () => {
    document.getElementById("sidebar").classList.toggle("open");
  });
}

async function loginByEmail(email) {
  const localUser = (state.data.users || []).find(user => user.email === email) || (state.data.users || [])[0];
  if (!localUser) return;
  try {
    if (state.apiOnline) {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password: document.getElementById("loginPassword")?.value || "demo" })
      });
      if (response.ok) {
        const payload = await response.json();
        saveSession(payload.user);
        render();
        return;
      }
    }
  } catch (error) {
    state.apiOnline = false;
  }
  saveSession(localUser);
  render();
}

async function handleDailySubmit() {
  const dailyId = document.getElementById("dailyId").value.trim();
  const projectId = document.getElementById("dailyProject").value;
  const unitCode = document.getElementById("dailyUnit").value;
  const quantity = Number(document.getElementById("dailyQuantity").value || 0);
  const laborHours = Number(document.getElementById("dailyLaborHours").value || 0);
  const laborRate = Number(document.getElementById("dailyLaborRate").value || 0);
  const equipmentSelect = document.getElementById("dailyEquipment");
  const equipmentId = equipmentSelect.value;
  const equipmentRate = Number(equipmentSelect.selectedOptions[0]?.dataset.rate || 0);
  const equipmentHours = Number(document.getElementById("dailyEquipmentHours").value || 0);
  const materialQty = Number(document.getElementById("dailyMaterialQty").value || 0);
  const notes = document.getElementById("dailyNotes").value;
  const project = state.data.projects.find(item => item.id === projectId);
  const unit = (state.data.projectUnits || []).find(item => item.project === projectId && item.unitCode === unitCode);

  const payload = {
    daily: {
      id: dailyId,
      project: projectId,
      date: new Date().toISOString().slice(0, 10),
      foreman: roleConfig.Foreman.person,
      crew: project?.crew || roleConfig.Foreman.crew,
      jsa: "Complete",
      inspections: "Forms 4, 7, 8 complete",
      locate: "Current",
      production: `${quantity.toLocaleString()} ${unit?.description || unitCode}`,
      laborHours,
      equipmentHours,
      materials: `SQUAN material: ${materialQty.toLocaleString()}`,
      output: "SQUAN daily, SOT, photos, payroll, inventory posted"
    },
    production: [{
      unitCode,
      description: unit?.description || unitCode,
      quantity,
      notes
    }],
    labor: [{
      employee: roleConfig.Foreman.person,
      hours: laborHours,
      costRate: laborRate,
      costCode: "LAB-FIBER"
    }],
    equipment: [{
      equipmentId,
      hours: equipmentHours,
      rate: equipmentRate,
      costCode: "EQ-BUCKET"
    }],
    materials: [{
      materialId: "MAT-SQ-FIBER",
      description: "SQUAN supplied material",
      quantity: materialQty,
      unitCost: 0,
      owner: "SQUAN"
    }]
  };

  try {
    await submitDailyWorkflow(payload);
  } catch (error) {
    alert("Daily could not be submitted. Confirm the ERP server is running.");
  }
}

render();
syncFromApi();
