const crypto = require("crypto");
const readline = require("readline");

function passwordHash(password, salt = crypto.randomBytes(16).toString("base64url")) {
  const key = crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt$16384$8$1$${salt}$${key.toString("base64url")}`;
}

function readPassword() {
  const inline = process.argv.slice(2).join(" ");
  if (inline) return Promise.resolve(inline);
  const rl = readline.createInterface({ input: process.stdin, output: process.stderr });
  return new Promise(resolve => {
    rl.question("Password to hash: ", answer => {
      rl.close();
      resolve(answer);
    });
  });
}

readPassword().then(password => {
  if (!password || password.length < 12) {
    console.error("Password must be at least 12 characters.");
    process.exit(1);
  }
  process.stdout.write(`${passwordHash(password)}\n`);
});
