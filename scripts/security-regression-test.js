const assert = require("assert");
const fs = require("fs");
const http = require("http");
const net = require("net");
const os = require("os");
const path = require("path");
const { spawn } = require("child_process");

const root = path.join(__dirname, "..");
const startPort = Number(process.env.SECURITY_QA_PORT || 8323);
const strongSecret = "security-test-secret-with-more-than-32-chars";

function passwordHash(password, salt = "security-test-salt") {
  const crypto = require("crypto");
  const key = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${key.toString("base64url")}`;
}

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

async function loginAs(baseUrl, email, password = "demo") {
  const response = await request(baseUrl, "/api/auth/login", {
    method: "POST",
    body: { email, password }
  });
  assert.strictEqual(response.status, 200, `login failed for ${email}: ${response.text}`);
  return JSON.parse(response.text).token;
}

async function waitForServer(baseUrl) {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const response = await request(baseUrl, "/api/health");
      if (response.status === 200) return;
    } catch (error) {
      // retry until timeout
    }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error("Security test server did not start");
}

async function run() {
  const port = await findOpenPort(startPort);
  const baseUrl = `http://127.0.0.1:${port}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "syncerp-security-qa-"));
  const tempDbPath = path.join(tempDir, "db.json");
  fs.copyFileSync(path.join(root, "data", "db.json"), tempDbPath);
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

    for (const pathname of ["/.env", "/data/db.json", "/server.js", "/package.json", "/docs/BUILD_OUTLINE.md"]) {
      const response = await request(baseUrl, pathname);
      assert([403, 404].includes(response.status), `${pathname} should not be publicly served; got ${response.status}`);
    }

    const unauthorized = await request(baseUrl, "/api/records/update", {
      method: "POST",
      body: { collection: "tasks", id: "TASK-DOES-NOT-MATTER", patch: { status: "Closed" } }
    });
    assert.strictEqual(unauthorized.status, 401, "unauthorized API write should be rejected");

    const login = await request(baseUrl, "/api/auth/login", { method: "POST", body: { email: "ronald@jacksontelcom.example", password: "demo" } });
    assert.strictEqual(login.status, 200, `demo login should work when DEMO_AUTH=true: ${login.text}`);
    const token = JSON.parse(login.text).token;
    assert(token, "login response should include a signed token");

    const bootstrap = await request(baseUrl, "/api/bootstrap", { token });
    assert.strictEqual(bootstrap.status, 200, "authenticated bootstrap should be allowed");

    const liveMode = await request(baseUrl, "/api/admin/go-live-mode", {
      method: "PUT",
      token,
      body: { mode: "Live Mode" }
    });
    assert.strictEqual(liveMode.status, 409, "Live Mode should be blocked while DEMO_AUTH=true");

    const foremanToken = await loginAs(baseUrl, "marcus@jacksontelcom.example");
    const foremanBackup = await request(baseUrl, "/api/admin/backup", { token: foremanToken });
    assert.strictEqual(foremanBackup.status, 403, "Foreman should not access admin backup export");

    const foremanCash = await request(baseUrl, "/api/company/cash-controls", {
      method: "PUT",
      token: foremanToken,
      body: { cashOnHand: 1 }
    });
    assert.strictEqual(foremanCash.status, 403, "Foreman should not update company cash controls");

    const auditWrite = await request(baseUrl, "/api/auditLog/AUD-0001", {
      method: "PUT",
      token,
      body: { id: "AUD-0001", action: "tamper" }
    });
    assert.strictEqual(auditWrite.status, 403, "auditLog should be read-only through generic CRUD");

    const uploadOk = await request(baseUrl, "/api/uploads/validate", {
      method: "POST",
      token: foremanToken,
      body: { project: "PO-SQ-24031", file: { name: "daily-photo.jpg", mimeType: "image/jpeg", size: 1024 } }
    });
    assert.strictEqual(uploadOk.status, 200, `valid upload metadata should pass: ${uploadOk.text}`);
    const uploadBad = await request(baseUrl, "/api/uploads/validate", {
      method: "POST",
      token: foremanToken,
      body: { file: { name: "malware.exe", mimeType: "application/x-msdownload", size: 1024 } }
    });
    assert.strictEqual(uploadBad.status, 400, "invalid upload metadata should fail");

    const reset = await request(baseUrl, "/api/auth/password-reset/request", {
      method: "POST",
      body: { email: "ronald@jacksontelcom.example" }
    });
    assert.strictEqual(reset.status, 200, `password reset request should succeed: ${reset.text}`);
    const resetToken = JSON.parse(reset.text).token;
    assert(resetToken, "demo reset response should include token for local QA");
    const resetConfirm = await request(baseUrl, "/api/auth/password-reset/confirm", {
      method: "POST",
      body: { token: resetToken, password: "new-local-passphrase" }
    });
    assert.strictEqual(resetConfirm.status, 200, `password reset confirm should succeed: ${resetConfirm.text}`);

    const prodPort = await findOpenPort(port + 1);
    const prodBaseUrl = `http://127.0.0.1:${prodPort}`;
    const prodDir = fs.mkdtempSync(path.join(os.tmpdir(), "syncerp-prod-auth-qa-"));
    const prodDbPath = path.join(prodDir, "db.json");
    const prodDb = JSON.parse(fs.readFileSync(path.join(root, "data", "db.json"), "utf8"));
    const admin = prodDb.users.find(user => user.email === "ronald@jacksontelcom.example");
    admin.passwordHash = passwordHash("production-passphrase");
    fs.writeFileSync(prodDbPath, `${JSON.stringify(prodDb, null, 2)}\n`);
    const prodServer = spawn(process.execPath, ["server.js"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(prodPort),
        DATA_DRIVER: "json",
        DB_PATH: prodDbPath,
        DEMO_AUTH: "false",
        PRODUCTION_MODE: "true",
        ALLOW_JSON_PRODUCTION: "true",
        ALLOW_INSECURE_HTTP: "true",
        AUTH_SECRET: strongSecret
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    try {
      await waitForServer(prodBaseUrl);
      const demoBlocked = await request(prodBaseUrl, "/api/auth/login", {
        method: "POST",
        body: { email: "ronald@jacksontelcom.example", password: "demo" }
      });
      assert.strictEqual(demoBlocked.status, 401, "demo password should not work when DEMO_AUTH=false");
      const prodLogin = await request(prodBaseUrl, "/api/auth/login", {
        method: "POST",
        body: { email: "ronald@jacksontelcom.example", password: "production-passphrase" }
      });
      assert.strictEqual(prodLogin.status, 200, `password-hash login should work in production auth mode: ${prodLogin.text}`);
      const prodRestore = await request(prodBaseUrl, "/api/admin/restore", {
        method: "POST",
        token: JSON.parse(prodLogin.text).token,
        body: { backup: prodDb, confirm: "RESTORE" }
      });
      assert.strictEqual(prodRestore.status, 403, "restore should be disabled without ALLOW_ADMIN_RESTORE=true");
    } finally {
      prodServer.kill();
      fs.rmSync(prodDir, { recursive: true, force: true });
    }

    console.log(`Security regression QA passed on ${baseUrl}`);
  } catch (error) {
    if (output.length) console.error(output.filter(Boolean).slice(-10).join("\n"));
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
