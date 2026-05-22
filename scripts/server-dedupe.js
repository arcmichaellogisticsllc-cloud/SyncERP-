const { execFileSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");
const keepPort = Number(process.env.PORT || 8080);

function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8" }).trim();
  } catch (error) {
    return "";
  }
}

function listeningNodeRows() {
  const output = run("lsof", ["-nP", "-a", "-c", "node", "-iTCP", "-sTCP:LISTEN"]);
  return output
    .split("\n")
    .slice(1)
    .map(line => line.trim())
    .filter(Boolean);
}

function processCwd(pid) {
  const output = run("lsof", ["-nP", "-p", String(pid)]);
  const cwdLine = output.split("\n").find(line => /\scwd\s+DIR\s/.test(line));
  return cwdLine ? cwdLine.replace(/^.*\s(\/.*)$/, "$1") : "";
}

function processCommand(pid) {
  return run("ps", ["-p", String(pid), "-o", "command="]);
}

function parseRow(row) {
  const columns = row.split(/\s+/);
  const pid = Number(columns[1]);
  const portMatch = row.match(/TCP\s+\S+:(\d+)\s+\(LISTEN\)$/);
  return {
    pid,
    port: portMatch ? Number(portMatch[1]) : null,
    cwd: processCwd(pid),
    command: processCommand(pid)
  };
}

const servers = listeningNodeRows()
  .map(parseRow)
  .filter(server => server.cwd === root)
  .sort((a, b) => (a.port || 0) - (b.port || 0));

const keep = servers.find(server => server.port === keepPort);
const duplicates = servers.filter(server => server.port !== keepPort);

if (!servers.length) {
  console.log(`No SyncERP Node listeners found for ${root}`);
  process.exit(0);
}

if (!keep) {
  console.log(`No SyncERP Node listener found on keep port ${keepPort}. No processes stopped.`);
  console.log("Running listeners:");
  for (const server of servers) console.log(`- port ${server.port}: pid ${server.pid}`);
  process.exit(1);
}

if (!duplicates.length) {
  console.log(`Only the canonical SyncERP server is running: port ${keep.port}, pid ${keep.pid}`);
  process.exit(0);
}

for (const server of duplicates) {
  try {
    process.kill(server.pid, "SIGTERM");
    console.log(`Stopped duplicate SyncERP server on port ${server.port}, pid ${server.pid}`);
  } catch (error) {
    console.error(`Failed to stop port ${server.port}, pid ${server.pid}: ${error.message}`);
    process.exitCode = 1;
  }
}

console.log(`Kept SyncERP server on port ${keep.port}, pid ${keep.pid}`);
