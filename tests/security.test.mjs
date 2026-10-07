import { test, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import worker from "../worker/index.mjs";
import {
  hashPassword,
  createPassword,
  verifyPassword,
} from "../worker/password.mjs";
let hash, env, db;
const origin = "https://tester.github.io";
const password = createPassword();
const build = {
  id: "fox-test",
  filename: "test.zip",
  sha256: "a".repeat(64),
  bytes: 4,
  branch: "14.1",
  title: "Test",
  device: "A55",
  version: "test",
  date: "2026-10-07",
  changelog: ["Test"],
  status: "testing",
};
before(async () => {
  hash = await hashPassword(password);
});
beforeEach(() => {
  db = new DatabaseSync(":memory:");
  db.exec(
    readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"),
  );
  db.prepare("INSERT INTO users(username,password_hash) VALUES(?,?)").run(
    "tester",
    hash,
  );
  const statement = (sql, args = []) => ({
    bind(...values) {
      return statement(sql, values);
    },
    async first() {
      return db.prepare(sql).get(...args) || null;
    },
    async run() {
      return db.prepare(sql).run(...args);
    },
  });
  env = {
    ALLOWED_ORIGIN: origin,
    DB: {
      prepare: statement,
      async batch(queries) {
        return Promise.all(queries.map((q) => q.run()));
      },
    },
    LOGIN_LIMITER: {
      async limit() {
        return { success: true };
      },
    },
    BUILDS: {
      async get(key) {
        if (key === "catalog.json")
          return { size: 200, json: async () => [build] };
        if (key === "builds/fox-test/test.zip")
          return { size: 4, body: new Blob(["test"]).stream() };
        return null;
      },
    },
  };
});
const request = (path, token, method = "GET", body, site = origin) =>
  worker.fetch(
    new Request("https://api.example" + path, {
      method,
      headers: {
        Origin: site,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
    env,
  );
async function login() {
  const response = await request("/api/login", null, "POST", {
    username: "tester",
    password,
  });
  assert.equal(response.status, 200);
  return (await response.json()).token;
}
test("catalog and download tickets require authentication", async () => {
  for (const [path, method] of [
    ["/api/builds", "GET"],
    ["/api/builds/fox-test/ticket", "POST"],
    ["/download/" + "a".repeat(43), "GET"],
  ])
    assert.equal((await request(path, null, method)).status, 401);
});
test("wrong password does not create a session", async () => {
  const r = await request("/api/login", null, "POST", {
    username: "tester",
    password: "incorrect",
  });
  assert.equal(r.status, 401);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
});
test("an authorized download streams the file, its ticket cannot be reused", async () => {
  const token = await login();
  const r = await request("/api/builds/fox-test/ticket", token, "POST");
  const url = (await r.json()).url;
  const download = await request(new URL(url).pathname);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), "test");
  assert.equal(download.headers.get("Cache-Control"), "no-store, private");
  assert.equal((await request(new URL(url).pathname)).status, 401);
});
test("logout immediately invalidates session and unconsumed tickets", async () => {
  const token = await login();
  const url = (
    await (await request("/api/builds/fox-test/ticket", token, "POST")).json()
  ).url;
  assert.equal((await request("/api/logout", token, "POST")).status, 200);
  assert.equal((await request("/api/builds", token)).status, 401);
  assert.equal((await request(new URL(url).pathname)).status, 401);
});
test("disabling an account revokes both catalog and pending download access", async () => {
  const token = await login();
  const url = (
    await (await request("/api/builds/fox-test/ticket", token, "POST")).json()
  ).url;
  db.prepare("UPDATE users SET active=0 WHERE username=?").run("tester");
  assert.equal((await request("/api/builds", token)).status, 401);
  assert.equal((await request(new URL(url).pathname)).status, 401);
});
test("expired sessions and download tickets cannot fetch files", async () => {
  const token = await login();
  const url = (
    await (await request("/api/builds/fox-test/ticket", token, "POST")).json()
  ).url;
  db.exec("UPDATE tickets SET expires=1");
  assert.equal((await request(new URL(url).pathname)).status, 401);
  db.exec("UPDATE sessions SET expires=1");
  assert.equal((await request("/api/builds", token)).status, 401);
});
test("untrusted origins cannot log in or read API responses", async () => {
  const r = await request(
    "/api/login",
    null,
    "POST",
    { username: "tester", password },
    "https://evil.example",
  );
  assert.equal(r.status, 403);
  assert.equal(r.headers.get("Access-Control-Allow-Origin"), null);
});
test("login is rate-limited before password verification", async () => {
  env.LOGIN_LIMITER = {
    async limit() {
      return { success: false };
    },
  };
  assert.equal(
    (
      await request("/api/login", null, "POST", {
        username: "tester",
        password,
      })
    ).status,
    429,
  );
});
test("catalog strings cannot select an arbitrary storage object", async () => {
  env.BUILDS.get = async () => ({
    size: 100,
    json: async () => [{ ...build, filename: "../../keys" }],
  });
  const token = await login();
  assert.equal((await request("/api/builds", token)).status, 503);
});

test("credentials are randomly generated and human passwords are rejected", async () => {
  const generated = createPassword();
  assert.match(generated, /^fox_[A-Za-z0-9_-]{32}$/);
  assert.notEqual(generated, password);
  assert.equal(
    await verifyPassword(generated, await hashPassword(generated)),
    true,
  );
  assert.equal(await verifyPassword("short-password", hash), false);
  await assert.rejects(hashPassword("ordinary-human-password"));
});
test("malformed login payload fails without creating sessions", async () => {
  const response = await worker.fetch(
    new Request("https://api.example/api/login", {
      method: "POST",
      headers: { Origin: origin, "Content-Type": "application/json" },
      body: "null",
    }),
    env,
  );
  assert.equal(response.status, 400);
  assert.equal(db.prepare("SELECT count(*) AS n FROM sessions").get().n, 0);
});
