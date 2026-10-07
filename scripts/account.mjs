import { hashPassword, createPassword } from "../worker/password.mjs";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const [action, enteredUsername, ...options] = process.argv.slice(2);
const username = enteredUsername?.toLowerCase();
if (
  !["create", "disable"].includes(action) ||
  !/^[a-z0-9_-]{2,40}$/.test(username || "") ||
  options.some((o) => !["--local", "--remote"].includes(o))
)
  throw new Error(
    "Usage: npm run account -- create|disable LOGIN --local|--remote",
  );
if (options.length !== 1)
  throw new Error("Choose exactly --local or --remote.");
if (action === "create" && !process.stdout.isTTY)
  throw new Error(
    "Run account creation in an interactive terminal: the generated password will be shown only to you.",
  );
let sql, password;
if (action === "create") {
  password = createPassword();
  const hash = await hashPassword(password);
  sql = `INSERT INTO users(username,password_hash,active) VALUES('${username}','${hash}',1) ON CONFLICT(username) DO UPDATE SET password_hash=excluded.password_hash,active=1; DELETE FROM sessions WHERE lower(username)='${username}';`;
} else
  sql = `UPDATE users SET active=0 WHERE username='${username}'; DELETE FROM sessions WHERE lower(username)='${username}';`;
const folder = mkdtempSync(join(tmpdir(), "fox-account-"));
try {
  const file = join(folder, "account.sql");
  writeFileSync(file, sql, { mode: 0o600 });
  const result = spawnSync(
    "npx",
    [
      "--no-install",
      "wrangler",
      "d1",
      "execute",
      "fox-test-builds",
      options[0],
      "--file",
      file,
    ],
    { stdio: ["inherit", "ignore", "inherit"] },
  );
  if (result.status !== 0) process.exitCode = result.status || 1;
  else {
    console.log(`Account ${username}: ${action} completed.`);
    if (password) console.log(`Password (save now; shown once): ${password}`);
  }
} finally {
  password = undefined;
  rmSync(folder, { recursive: true, force: true });
}
