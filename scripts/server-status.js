const { execFileSync } = require("child_process");
const path = require("path");

const root = path.resolve(__dirname, "..");

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

function processStart(pid) {
  return run("ps", ["-p", String(pid), "-o", "lstart="]).replace(/\s+/g, " ");
}

function parseRow(row) {
  const columns = row.split(/\s+/);
  const pid = Number(columns[1]);
  const portMatch = row.match(/TCP\s+\S+:(\d+)\s+\(LISTEN\)$/);
  return {
    pid,
    port: portMatch ? Number(portMatch[1]) : null,
    cwd: processCwd(pid),
    command: processCommand(pid),
    started: processStart(pid)
  };
}

const servers = listeningNodeRows()
  .map(parseRow)
  .filter(server => server.cwd === root)
  .sort((a, b) => (a.port || 0) - (b.port || 0));

if (!servers.length) {
  console.log(`No SyncERP Node listeners found for ${root}`);
  process.exit(0);
}

console.log(`SyncERP Node listeners for ${root}:`);
for (const server of servers) {
  const command = server.command ? `, command ${server.command}` : "";
  console.log(`- port ${server.port}: pid ${server.pid}, started ${server.started}${command}`);
}
