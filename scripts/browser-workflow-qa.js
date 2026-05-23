const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");
const appStartPort = Number(process.env.BROWSER_QA_APP_PORT || 8223);
const chromeStartPort = Number(process.env.BROWSER_QA_CHROME_PORT || 9333);
const chromePath = process.env.CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const cdpCommandTimeoutMs = Number(process.env.BROWSER_QA_CDP_TIMEOUT_MS || 60000);
const appLoadTimeoutMs = Number(process.env.BROWSER_QA_APP_LOAD_TIMEOUT_MS || 45000);

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
    server.once("listening", () => server.close(() => resolve(port)));
    server.listen(port, "127.0.0.1");
  });
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    http.get(url, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${url} returned HTTP ${res.statusCode}`));
          return;
        }
        resolve(JSON.parse(body));
      });
    }).on("error", reject);
  });
}

function getText(url, token = "") {
  return new Promise((resolve, reject) => {
    const options = token ? { headers: { Authorization: `Bearer ${token}` } } : {};
    http.get(url, options, res => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        body += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${url} returned HTTP ${res.statusCode}`));
          return;
        }
        resolve(body);
      });
    }).on("error", reject);
  });
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    const text = JSON.stringify(body);
    const req = http.request(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(text)
      }
    }, res => {
      let responseBody = "";
      res.setEncoding("utf8");
      res.on("data", chunk => {
        responseBody += chunk;
      });
      res.on("end", () => {
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`${url} returned HTTP ${res.statusCode}`));
          return;
        }
        resolve(JSON.parse(responseBody || "{}"));
      });
    });
    req.on("error", reject);
    req.end(text);
  });
}

async function waitForHttp(url, timeoutMs = 10000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      await getText(url);
      return;
    } catch (error) {
      lastError = error;
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }
  throw lastError || new Error(`${url} did not respond`);
}

function parseWebSocketUrl(url) {
  const parsed = new URL(url);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 80),
    path: `${parsed.pathname}${parsed.search}`
  };
}

class CdpSocket {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.buffer = Buffer.alloc(0);
    this.pending = new Map();
    this.events = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      const { host, port, path: wsPath } = parseWebSocketUrl(this.url);
      const key = crypto.randomBytes(16).toString("base64");
      this.socket = net.createConnection({ host, port }, () => {
        this.socket.write([
          `GET ${wsPath} HTTP/1.1`,
          `Host: ${host}:${port}`,
          "Upgrade: websocket",
          "Connection: Upgrade",
          `Sec-WebSocket-Key: ${key}`,
          "Sec-WebSocket-Version: 13",
          "",
          ""
        ].join("\r\n"));
      });
      this.socket.once("error", reject);
      let handshake = Buffer.alloc(0);
      const onHandshake = chunk => {
        handshake = Buffer.concat([handshake, chunk]);
        const end = handshake.indexOf("\r\n\r\n");
        if (end === -1) return;
        const header = handshake.slice(0, end).toString("utf8");
        if (!header.includes("101")) {
          reject(new Error(`Chrome DevTools WebSocket failed: ${header.split("\r\n")[0]}`));
          return;
        }
        this.socket.off("data", onHandshake);
        this.socket.on("data", data => this.onData(data));
        const rest = handshake.slice(end + 4);
        if (rest.length) this.onData(rest);
        resolve();
      };
      this.socket.on("data", onHandshake);
    });
  }

  frame(payload) {
    const data = Buffer.from(payload);
    const mask = crypto.randomBytes(4);
    let header;
    if (data.length < 126) {
      header = Buffer.from([0x81, 0x80 | data.length]);
    } else if (data.length < 65536) {
      header = Buffer.alloc(4);
      header[0] = 0x81;
      header[1] = 0x80 | 126;
      header.writeUInt16BE(data.length, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x81;
      header[1] = 0x80 | 127;
      header.writeBigUInt64BE(BigInt(data.length), 2);
    }
    const masked = Buffer.alloc(data.length);
    for (let index = 0; index < data.length; index += 1) {
      masked[index] = data[index] ^ mask[index % 4];
    }
    return Buffer.concat([header, mask, masked]);
  }

  onData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (this.buffer.length >= 2) {
      const first = this.buffer[0];
      const second = this.buffer[1];
      const opcode = first & 0x0f;
      let length = second & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (this.buffer.length < offset + 2) return;
        length = this.buffer.readUInt16BE(offset);
        offset += 2;
      } else if (length === 127) {
        if (this.buffer.length < offset + 8) return;
        length = Number(this.buffer.readBigUInt64BE(offset));
        offset += 8;
      }
      const masked = Boolean(second & 0x80);
      const maskOffset = masked ? 4 : 0;
      if (this.buffer.length < offset + maskOffset + length) return;
      const mask = masked ? this.buffer.slice(offset, offset + 4) : null;
      offset += maskOffset;
      const payload = Buffer.from(this.buffer.slice(offset, offset + length));
      this.buffer = this.buffer.slice(offset + length);
      if (masked && mask) {
        for (let index = 0; index < payload.length; index += 1) payload[index] ^= mask[index % 4];
      }
      if (opcode === 0x8) return;
      if (opcode !== 0x1) continue;
      const message = JSON.parse(payload.toString("utf8"));
      if (message.id && this.pending.has(message.id)) {
        const { resolve, reject } = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message || JSON.stringify(message.error)));
        else resolve(message.result || {});
      } else if (message.method) {
        this.events.push(message);
      }
    }
  }

  send(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = JSON.stringify({ id, method, params });
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.write(this.frame(payload));
      setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        const detail = params?.expression ? `: ${String(params.expression).replace(/\s+/g, " ").slice(0, 180)}` : "";
        reject(new Error(`${method} timed out${detail}`));
      }, cdpCommandTimeoutMs);
    });
  }

  close() {
    this.socket?.destroy();
  }
}

async function waitForChrome(port, timeoutMs = 10000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    try {
      const list = await getJson(`http://127.0.0.1:${port}/json/list`);
      const page = list.find(item => item.type === "page" && item.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw lastError || new Error("Chrome DevTools did not start");
}

function expressionValue(result) {
  if (result?.exceptionDetails) {
    throw new Error(result.exceptionDetails.text || "Browser expression failed");
  }
  return result?.result?.value;
}

function waitForExit(child, timeoutMs = 1500) {
  return new Promise(resolve => {
    if (!child || child.exitCode !== null || child.signalCode) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, timeoutMs);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function evaluate(cdp, expression) {
  return expressionValue(await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true
  }));
}

async function waitFor(cdp, expression, label, timeoutMs = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(cdp, expression)) return;
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function setViewport(cdp, width, height, label) {
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile: width < 700
  });
  await new Promise(resolve => setTimeout(resolve, 150));
  if (label) console.log(`Viewport QA: ${label} ${width}x${height}`);
}

async function click(cdp, selector, label = selector) {
  const clicked = await evaluate(cdp, `(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return false;
    element.click();
    return true;
  })()`);
  if (!clicked) throw new Error(`Missing clickable element: ${label}`);
  await new Promise(resolve => setTimeout(resolve, 250));
}

async function assertText(cdp, text, label = text) {
  const found = await evaluate(cdp, `document.body && document.body.innerText.toLowerCase().includes(${JSON.stringify(String(text).toLowerCase())})`);
  if (!found) {
    const snapshot = await evaluate(cdp, `document.body?.innerText?.replace(/\\s+/g, " ").slice(0, 700) || ""`);
    throw new Error(`Missing text after click: ${label}. Visible text: ${snapshot}`);
  }
}

async function assertSelector(cdp, selector, label = selector) {
  const found = await evaluate(cdp, `Boolean(document.querySelector(${JSON.stringify(selector)}))`);
  if (!found) throw new Error(`Missing selector: ${label}`);
}

async function assertLink(cdp, hrefPart, label = hrefPart) {
  const found = await evaluate(cdp, `Boolean([...document.querySelectorAll("a[href]")].find(link => link.href.includes(${JSON.stringify(hrefPart)})))`);
  if (!found) throw new Error(`Missing export link: ${label}`);
}

async function assertNotBlank(cdp, label) {
  const state = await evaluate(cdp, `(() => {
    const app = document.querySelector("#app");
    return {
      appChildren: app ? app.children.length : 0,
      bodyLength: document.body?.innerText?.trim().length || 0,
      errors: [...document.querySelectorAll(".error, [role='alert']")].map(item => item.innerText).join(" | ")
    };
  })()`);
  if (!state.appChildren || state.bodyLength < 50) {
    throw new Error(`${label} rendered blank: ${JSON.stringify(state)}`);
  }
}

async function assertNoHorizontalOverflow(cdp, label) {
  const overflow = await evaluate(cdp, `(() => {
    const width = window.innerWidth;
    const docOverflow = Math.max(0, document.documentElement.scrollWidth - width);
    const offenders = [...document.querySelectorAll("main *, .content *")]
      .filter(element => {
        const style = getComputedStyle(element);
        if (style.display === "none" || style.visibility === "hidden" || style.position === "fixed") return false;
        const rect = element.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return false;
        return rect.right > width + 2 || rect.left < -2;
      })
      .slice(0, 5)
      .map(element => ({
        tag: element.tagName.toLowerCase(),
        className: String(element.className || "").slice(0, 80),
        text: String(element.innerText || element.value || "").replace(/\\s+/g, " ").slice(0, 90),
        left: Math.round(element.getBoundingClientRect().left),
        right: Math.round(element.getBoundingClientRect().right)
      }));
    return { width, scrollWidth: document.documentElement.scrollWidth, docOverflow, offenders };
  })()`);
  if (overflow.docOverflow > 4) {
    throw new Error(`${label} has horizontal overflow: ${JSON.stringify(overflow)}`);
  }
}

async function assertTapTargets(cdp, selectors, label) {
  const failures = await evaluate(cdp, `(() => {
    const selectors = ${JSON.stringify(selectors)};
    return selectors.flatMap(selector => [...document.querySelectorAll(selector)].map(element => {
      const rect = element.getBoundingClientRect();
      return {
        selector,
        text: String(element.innerText || element.value || element.getAttribute("aria-label") || "").replace(/\\s+/g, " ").slice(0, 80),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      };
    })).filter(item => item.width < 40 || item.height < 40).slice(0, 8);
  })()`);
  if (failures.length) {
    throw new Error(`${label} has small tap targets: ${JSON.stringify(failures)}`);
  }
}

async function assertForemanFormOrder(cdp) {
  const order = await evaluate(cdp, `(() => {
    const ids = ["productionProject", "productionCode", "productionQuantity", "productionProofNote"];
    return ids.map(id => {
      const element = document.getElementById(id);
      if (!element) return { id, top: -1 };
      return { id, top: Math.round(element.getBoundingClientRect().top) };
    });
  })()`);
  if (order.some(item => item.top < 0)) throw new Error(`Foreman form missing required field: ${JSON.stringify(order)}`);
  for (let index = 1; index < order.length; index += 1) {
    if (order[index].top + 4 < order[index - 1].top) {
      throw new Error(`Foreman form order regressed: ${JSON.stringify(order)}`);
    }
  }
}

async function setSession(cdp, baseUrl, user) {
  const login = await postJson(`${baseUrl}/api/auth/login`, { email: user.email, password: "demo" });
  await cdp.send("Page.navigate", { url: "about:blank" });
  await new Promise(resolve => setTimeout(resolve, 200));
  await cdp.send("Page.navigate", { url: baseUrl });
  await waitFor(cdp, "document.readyState === 'complete'", "initial app load", appLoadTimeoutMs);
  await evaluate(cdp, `localStorage.clear(); localStorage.setItem("jackson-syncerp-session", ${JSON.stringify(JSON.stringify(login.user || user))}); localStorage.setItem("jackson-syncerp-auth-token", ${JSON.stringify(login.token)}); true`);
  await cdp.send("Page.navigate", { url: baseUrl });
  await waitFor(cdp, "document.readyState === 'complete' && Boolean(document.querySelector('#app'))", `${user.role} app shell`, appLoadTimeoutMs);
  await waitFor(cdp, `document.body.innerText.includes(${JSON.stringify(user.name)}) || document.body.innerText.includes(${JSON.stringify(user.role)})`, `${user.role} session`, appLoadTimeoutMs);
  await assertNotBlank(cdp, `${user.role} home`);
}

async function runBrowserQa(cdp, baseUrl) {
  const users = {
    admin: { id: "U-001", name: "Ronald Jackson", email: "ronald@jacksontelcom.example", role: "Admin", defaultView: "dashboard" },
    foreman: { id: "U-002", name: "Marcus Hill", email: "marcus@jacksontelcom.example", role: "Foreman", defaultView: "field" },
    billing: { id: "U-004", name: "Office Billing", email: "billing@jacksontelcom.example", role: "Billing", defaultView: "dashboard" },
    safety: { id: "U-005", name: "Safety Lead", email: "safety@jacksontelcom.example", role: "Safety/Compliance", defaultView: "dashboard" }
  };

  await setSession(cdp, baseUrl, users.foreman);
  await click(cdp, '[data-view="production"]', "Foreman Daily Capture nav");
  await assertText(cdp, "Daily Capture", "Foreman Daily Capture");
  await click(cdp, '[data-production-mode="Submit Daily"]', "Submit Daily mode");
  await assertSelector(cdp, '[data-production-mode-panel="Submit Daily"]', "Submit Daily panel");
  await waitFor(cdp, `document.querySelectorAll("#productionCode option").length >= 128`, "server price catalog sync", appLoadTimeoutMs);
  const foremanCodeCatalog = await evaluate(cdp, `(() => {
    const options = [...document.querySelectorAll("#productionCode option")].map(option => ({
      value: option.value,
      text: option.textContent,
      rate: option.dataset.rate,
      readiness: option.dataset.readiness
    }));
    return {
      hasSpliceCode: options.some(option => option.value === "BSMI-015" && option.text.includes("Splice")),
      hasAerialCode: options.some(option => option.value === "WC-1" && option.readiness === "Ready"),
      rateLabelVisible: Boolean(document.querySelector('[data-code-preview="rate"]')),
      codeCount: options.length
    };
  })()`);
  if (!foremanCodeCatalog.hasSpliceCode || !foremanCodeCatalog.hasAerialCode || foremanCodeCatalog.rateLabelVisible || foremanCodeCatalog.codeCount < 128) {
    throw new Error(`Foreman billing-code catalog is incomplete or exposing rates: ${JSON.stringify(foremanCodeCatalog)}`);
  }
  await evaluate(cdp, `(() => {
    document.querySelector("#productionQuantity").value = "12";
    document.querySelector("#productionProofNote").value = "Browser QA proof note";
    document.querySelector("#productionQuantity").dispatchEvent(new Event("input", { bubbles: true }));
    document.querySelector("#productionProofNote").dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  })()`);
  await assertSelector(cdp, "#productionDailyForm button[type='submit']:not([disabled])", "enabled daily submit button");
  await assertNotBlank(cdp, "Foreman Submit Daily");
  await assertForemanFormOrder(cdp);

  await setSession(cdp, baseUrl, users.admin);
  await click(cdp, '[data-workflow-action="Production"][data-workflow-focus="Daily Capture"], [data-workflow-action="Production"]', "Admin Daily Capture workflow card");
  await click(cdp, '[data-production-mode="Command"]', "Admin Command mode");
  await waitFor(cdp, `Boolean(document.querySelector('[data-production-mode-panel="Command"]'))`, "Admin Command panel");
  await assertText(cdp, "Admin visibility", "Admin Daily Capture visibility");
  await click(cdp, '[data-production-mode="Review"]', "Admin Review mode");
  await assertSelector(cdp, '[data-production-mode-panel="Review"]', "Admin Review panel");
  await assertSelector(cdp, "[data-admin-daily-review-workstation]", "Admin Review workstation");
  await assertSelector(cdp, "[data-production-daily-action='approve-valid']", "Admin daily approve-valid action");
  await assertSelector(cdp, "[data-production-daily-action='return']", "Admin daily return action");
  await assertSelector(cdp, "[data-admin-review-line-id]", "Admin review line cards");
  await assertText(cdp, "Selected daily history and next handoff", "Admin Review decision handoff");
  const selectedRealDaily = await evaluate(cdp, `(() => {
    const select = document.querySelector('[data-production-daily-select]');
    if (!select) return false;
    const option = [...select.options].find(item => item.textContent.includes('226231') || item.textContent.includes('BSP-MIC-0197'));
    if (!option) return false;
    select.value = option.value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  if (!selectedRealDaily) throw new Error("Real daily BSP-MIC-0197 / 226231 was not available in Admin Review");
  await assertSelector(cdp, "[data-admin-review-fix]", "Admin Review checklist fix action");
  const safetyFixOpened = await evaluate(cdp, `(() => {
    const safetyFix = document.querySelector('[data-admin-review-fix="safety"]');
    if (!safetyFix) return false;
    safetyFix.click();
    return true;
  })()`);
  if (safetyFixOpened) {
    await assertText(cdp, "Safety", "Admin Review safety remediation route");
    await assertText(cdp, "BSP-MIC-0197", "Safety remediation selected Map filter");
    await click(cdp, '[data-view="production"]', "Return to Daily Capture after safety remediation");
    await click(cdp, '[data-production-mode="Review"]', "Return to Admin Review mode");
  }
  await evaluate(cdp, `(() => {
    const drawers = [...document.querySelectorAll("details.admin-review-secondary")];
    const detail = drawers.find(item => item.textContent.includes("Full selected daily detail"));
    if (detail) detail.open = true;
    return Boolean(detail);
  })()`);
  await assertText(cdp, "BSP-MIC-0197", "real RDB daily detail");
  await assertText(cdp, "A Daily Was Saved", "RDB saved history");
  await assertText(cdp, "Prior Approval Required", "prior approval billing state");
  await click(cdp, '[data-production-daily-open]', "Admin open daily");
  await assertSelector(cdp, ".production-daily-detail", "Admin daily detail");
  await assertNotBlank(cdp, "Admin Review");

  await setSession(cdp, baseUrl, users.billing);
  await click(cdp, '[data-view="money"]', "Billing nav");
  await assertText(cdp, "Billing", "Billing page");
  await assertText(cdp, "Billing package work queue", "Billing submit-today dashboard");
  await assertLink(cdp, "/api/reports/approved-production.csv", "Billing approved production export");
  await assertLink(cdp, "/api/reports/ready-to-submit.csv", "Billing ready-to-submit export");
  await assertLink(cdp, "/api/reports/billing-package-payments.csv", "Billing payment ledger export");
  await click(cdp, '[data-billing-package]', "Billing package row");
  await assertSelector(cdp, ".billing-package-detail", "Billing package detail");
  await assertText(cdp, "Package readiness", "Billing package readiness score");
  await assertSelector(cdp, '[data-billing-action="submit-squan"]', "manual SQUAN Tracker submission action");
  await assertSelector(cdp, '[data-billing-action="record-squan-response"]', "SQUAN response action");
  await assertSelector(cdp, '[data-billing-action="record-squan-package-payment"]', "SQUAN payment action");
  await assertSelector(cdp, '[data-billing-action="record-contractor-package-payment"]', "Contractor payment action");
  await assertLink(cdp, "/api/reports/squan-tracker-record.csv?key=", "Selected SQUAN Tracker record export");
  await assertNotBlank(cdp, "Billing Package");

  await click(cdp, '[data-view="production"]', "Billing Daily Capture nav");
  await click(cdp, '[data-production-mode="Billing Handoff"]', "Billing Handoff mode");
  await assertSelector(cdp, '[data-production-mode-panel="Billing Handoff"]', "Billing Handoff panel");
  await assertText(cdp, "This view starts from approved Daily Capture lines", "Billing Handoff approved dailies");
  await assertText(cdp, "Prime/Brightspeed price sheet control", "Billing Handoff price sheet control");
  await assertLink(cdp, "/api/reports/approved-production.csv", "Daily Capture approved export");
  await assertLink(cdp, "/api/reports/ready-to-submit.csv", "Daily Capture ready export");
  await assertLink(cdp, "/api/reports/price-sheet-catalog.csv", "Daily Capture price sheet catalog export");
  await assertNotBlank(cdp, "Billing Handoff export view");

  await click(cdp, '[data-view="reports"]', "Reports nav");
  await assertText(cdp, "Reports", "Reports page");
  for (const mode of ["Daily Production", "Packet Readiness", "Audit / Exports"]) {
    await click(cdp, `[data-report-mode="${mode}"]`, `${mode} report tab`);
    await assertText(cdp, mode, `${mode} report mode`);
    await assertNotBlank(cdp, `${mode} report mode`);
  }
  await click(cdp, '[data-report-mode="Audit / Exports"]', "Audit exports mode");
  await assertLink(cdp, "/api/reports/approved-production.csv", "Reports approved export");
  await assertLink(cdp, "/api/reports/ready-to-submit.csv", "Reports ready export");
  await assertLink(cdp, "/api/reports/billing-package-lifecycle.csv", "Reports lifecycle export");
  await assertLink(cdp, "/api/reports/billing-package-exceptions.csv", "Reports exceptions export");
  await assertLink(cdp, "/api/reports/billing-package-payments.csv", "Reports payments export");
  await assertLink(cdp, "/api/reports/price-sheet-catalog.csv", "Reports price sheet catalog export");

  await setSession(cdp, baseUrl, users.safety);
  await click(cdp, '[data-view="risk"]', "Safety risk nav");
  await assertText(cdp, "Fix safety problems", "Safety risk queue");
  await assertSelector(cdp, ".safety-simple-home", "Safety queue panel");
  await assertSelector(cdp, '[data-workflow-action="Safety & Risk"], [data-task-open], [data-open-record]', "Safety route action");
  await assertNotBlank(cdp, "Safety/Compliance risk queue");

  await click(cdp, '[data-view="reports"]', "Safety reports nav");
  await assertText(cdp, "Reports", "Safety reports");
  await click(cdp, '[data-report-mode="Audit / Exports"]', "Safety audit exports mode");
  await assertLink(cdp, "/api/reports/audit-package", "Safety audit package export");
  await assertNotBlank(cdp, "Safety/Compliance reports");

  const browserErrors = cdp.events.filter(event => ["Runtime.exceptionThrown", "Log.entryAdded"].includes(event.method))
    .filter(event => event.method !== "Log.entryAdded" || ["error", "warning"].includes(event.params?.entry?.level))
    .filter(event => !String(event.params?.entry?.url || "").endsWith("/favicon.ico"));
  if (browserErrors.length) {
    throw new Error(`Browser emitted errors: ${browserErrors.slice(0, 3).map(event => JSON.stringify(event.params)).join(" | ")}`);
  }
}

async function runResponsiveVisualQa(cdp, baseUrl) {
  const users = {
    admin: { id: "U-001", name: "Ronald Jackson", email: "ronald@jacksontelcom.example", role: "Admin", defaultView: "dashboard" },
    foreman: { id: "U-002", name: "Marcus Hill", email: "marcus@jacksontelcom.example", role: "Foreman", defaultView: "field" },
    billing: { id: "U-004", name: "Office Billing", email: "billing@jacksontelcom.example", role: "Billing", defaultView: "dashboard" },
    safety: { id: "U-005", name: "Safety Lead", email: "safety@jacksontelcom.example", role: "Safety/Compliance", defaultView: "dashboard" }
  };
  const viewports = [
    ["phone", 390, 844],
    ["tablet", 820, 1180],
    ["desktop", 1440, 900]
  ];

  for (const [name, width, height] of viewports) {
    await setViewport(cdp, width, height, name);

    await setSession(cdp, baseUrl, users.foreman);
    await click(cdp, '[data-view="production"]', `${name} Foreman Daily Capture nav`);
    await click(cdp, '[data-production-mode="Submit Daily"]', `${name} Submit Daily mode`);
    await assertSelector(cdp, '[data-production-mode-panel="Submit Daily"]', `${name} Submit Daily panel`);
    await waitFor(cdp, `document.querySelectorAll("#productionCode option").length >= 128`, `${name} server price catalog sync`, appLoadTimeoutMs);
    await assertForemanFormOrder(cdp);
    await assertTapTargets(cdp, [
      "#productionProject",
      "#productionCode",
      "#productionQuantity",
      "#productionProofNote",
      "#productionDailyForm button",
      ".production-code-quick-picks button"
    ], `${name} Foreman Daily Capture`);
    await assertNoHorizontalOverflow(cdp, `${name} Foreman Daily Capture`);

    await setSession(cdp, baseUrl, users.admin);
    await click(cdp, '[data-workflow-action="Production"][data-workflow-focus="Daily Capture"], [data-workflow-action="Production"]', `${name} Admin Daily Capture`);
    await click(cdp, '[data-production-mode="Review"]', `${name} Admin Review mode`);
    await assertSelector(cdp, '[data-production-mode-panel="Review"]', `${name} Admin Review panel`);
    await assertNoHorizontalOverflow(cdp, `${name} Admin Review`);

    await setSession(cdp, baseUrl, users.billing);
    await click(cdp, '[data-view="money"]', `${name} Billing nav`);
    await assertSelector(cdp, ".billing-package-command", `${name} Billing command`);
    await assertNoHorizontalOverflow(cdp, `${name} Billing command`);
    await click(cdp, '[data-view="reports"]', `${name} Reports nav`);
    await click(cdp, '[data-report-mode="Audit / Exports"]', `${name} Audit exports`);
    await assertSelector(cdp, ".report-export-groups", `${name} grouped export hub`);
    await assertNoHorizontalOverflow(cdp, `${name} Reports export hub`);

    await setSession(cdp, baseUrl, users.safety);
    await click(cdp, '[data-view="risk"]', `${name} Safety risk`);
    await assertSelector(cdp, ".safety-simple-home", `${name} Safety home`);
    await assertNoHorizontalOverflow(cdp, `${name} Safety risk`);
  }
}

async function run() {
  if (!fs.existsSync(chromePath)) {
    throw new Error(`Chrome not found at ${chromePath}. Set CHROME_PATH to run browser workflow QA.`);
  }
  const [appPort, chromePort] = await Promise.all([findOpenPort(appStartPort), findOpenPort(chromeStartPort)]);
  const baseUrl = `http://127.0.0.1:${appPort}`;
  const tempDbDir = fs.mkdtempSync(path.join(os.tmpdir(), "syncerp-browser-db-"));
  const tempDbPath = path.join(tempDbDir, "db.json");
  fs.copyFileSync(path.join(root, "data", "db.json"), tempDbPath);
  const app = spawn(process.execPath, ["server.js"], {
    cwd: root,
    env: { ...process.env, PORT: String(appPort), DATA_DRIVER: "json", DEMO_AUTH: "true", DB_PATH: tempDbPath },
    stdio: ["ignore", "pipe", "pipe"]
  });
  const chromeProfile = fs.mkdtempSync(path.join(os.tmpdir(), "syncerp-browser-qa-"));
  const chrome = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    `--remote-debugging-port=${chromePort}`,
    `--user-data-dir=${chromeProfile}`,
    "about:blank"
  ], { stdio: ["ignore", "pipe", "pipe"] });

  const output = [];
  app.stdout.on("data", chunk => output.push(String(chunk).trim()));
  app.stderr.on("data", chunk => output.push(String(chunk).trim()));
  chrome.stderr.on("data", chunk => output.push(String(chunk).trim()));

  let cdp;
  try {
    await waitForHttp(baseUrl, 30000);
    const wsUrl = await waitForChrome(chromePort, 30000);
    cdp = new CdpSocket(wsUrl);
    await cdp.connect();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    await cdp.send("Log.enable");
    await setViewport(cdp, 1440, 900, "desktop");
    await runBrowserQa(cdp, baseUrl);
    await runResponsiveVisualQa(cdp, baseUrl);

    const csvExpectations = [
      "/api/reports/approved-production.csv",
      "/api/reports/ready-to-submit.csv",
      "/api/reports/billing-package-lifecycle.csv",
      "/api/reports/billing-package-exceptions.csv",
      "/api/reports/billing-package-payments.csv",
      "/api/reports/price-sheet-catalog.csv"
    ];
    const adminLogin = await postJson(`${baseUrl}/api/auth/login`, { email: "ronald@jacksontelcom.example", password: "demo" });
    for (const pathname of csvExpectations) {
      const body = await getText(`${baseUrl}${pathname}`, adminLogin.token);
      if (!body.includes(",")) throw new Error(`${pathname} did not return CSV content`);
    }
    console.log(`Browser workflow QA passed on ${baseUrl}`);
  } catch (error) {
    console.error("Browser workflow QA failed.");
    if (output.length) console.error(output.filter(Boolean).slice(-12).join("\n"));
    throw error;
  } finally {
    cdp?.close();
    app.kill();
    chrome.kill();
    await Promise.all([waitForExit(app), waitForExit(chrome)]);
    try {
      fs.rmSync(chromeProfile, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      fs.rmSync(tempDbDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
    } catch (error) {
      if (process.env.BROWSER_QA_STRICT_CLEANUP === "1") throw error;
    }
  }
}

run().catch(error => {
  console.error(error.message);
  process.exit(1);
});
