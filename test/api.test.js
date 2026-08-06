import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const tmp = mkdtempSync(path.join(tmpdir(), "saas-test-"));
process.env.NODE_ENV = "test";
process.env.DB_FILE = path.join(tmp, "test.db");
process.env.JWT_SECRET = "test-secret";

const { createApp } = await import("../src/app.js");
const { db } = await import("../src/db.js");

let server;
let base;

before(() => {
  server = createApp().listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

async function req(method, url, { body, headers } = {}) {
  const res = await fetch(base + url, {
    method,
    headers: {
      ...(body ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { res, data, setCookie: res.headers.get("set-cookie") };
}

function cookieOf(setCookie) {
  return setCookie?.split(";")[0] ?? "";
}

async function registerUser(overrides = {}) {
  const { res, data, setCookie } = await req("POST", "/api/auth/register", {
    body: {
      name: "Tester",
      email: `u${Date.now()}${Math.random().toString(36).slice(2, 6)}@example.com`,
      password: "super-secret-123",
      ...overrides,
    },
  });
  return { res, data, setCookie, cookie: cookieOf(setCookie) };
}

const user = { name: "Ada Lovelace", email: "ada@example.com", password: "super-secret-123" };

test("GET /healthz", async () => {
  const { res, data } = await req("GET", "/healthz");
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
});

test("register creates a free user and sets a session cookie", async () => {
  const { res, data, setCookie } = await req("POST", "/api/auth/register", { body: user });
  assert.equal(res.status, 201);
  assert.equal(data.user.email, user.email);
  assert.equal(data.user.plan, "free");
  assert.ok(data.user.apiKey.startsWith("sk_live_"));
  assert.match(setCookie, /token=/);
});

test("register rejects duplicate email with 409", async () => {
  const { res } = await req("POST", "/api/auth/register", { body: user });
  assert.equal(res.status, 409);
});

test("register rejects short password with 400", async () => {
  const { res } = await req("POST", "/api/auth/register", {
    body: { name: "Short", email: "short@example.com", password: "abc" },
  });
  assert.equal(res.status, 400);
});

test("login with wrong password returns 401", async () => {
  const { res } = await req("POST", "/api/auth/login", {
    body: { email: user.email, password: "wrong-password" },
  });
  assert.equal(res.status, 401);
});

test("login with correct credentials returns a session cookie", async () => {
  const { res, setCookie } = await req("POST", "/api/auth/login", {
    body: { email: user.email, password: user.password },
  });
  assert.equal(res.status, 200);
  assert.match(setCookie, /token=/);
});

test("GET /api/auth/me returns the user when authenticated", async () => {
  const login = await req("POST", "/api/auth/login", {
    body: { email: user.email, password: user.password },
  });
  const { res, data } = await req("GET", "/api/auth/me", {
    headers: { Cookie: cookieOf(login.setCookie) },
  });
  assert.equal(res.status, 200);
  assert.equal(data.user.email, user.email);
});

test("GET /api/auth/me returns 401 without a token", async () => {
  const { res } = await req("GET", "/api/auth/me");
  assert.equal(res.status, 401);
});

test("GET /api/plans lists all plans for an authenticated user", async () => {
  const login = await req("POST", "/api/auth/login", {
    body: { email: user.email, password: user.password },
  });
  const { res, data } = await req("GET", "/api/plans", {
    headers: { Cookie: cookieOf(login.setCookie) },
  });
  assert.equal(res.status, 200);
  assert.equal(data.plans.length, 3);
  assert.deepEqual(
    data.plans.map((p) => p.id),
    ["free", "pro", "enterprise"],
  );
});

test("dashboard stats reflect a fresh free account", async () => {
  const login = await req("POST", "/api/auth/login", {
    body: { email: user.email, password: user.password },
  });
  const { res, data } = await req("GET", "/api/dashboard/stats", {
    headers: { Cookie: cookieOf(login.setCookie) },
  });
  assert.equal(res.status, 200);
  assert.equal(data.user.plan, "free");
  assert.equal(data.usage.used, 0);
  assert.equal(data.usage.quota, 1000);
});

test("subscribe upgrades the account to Pro", async () => {
  const login = await req("POST", "/api/auth/login", {
    body: { email: user.email, password: user.password },
  });
  const { res, data } = await req("POST", "/api/billing/subscribe", {
    headers: { Cookie: cookieOf(login.setCookie) },
    body: { plan_id: "pro", payment_method: "card" },
  });
  assert.equal(res.status, 200);
  assert.equal(data.subscription.planId, "pro");
  assert.equal(data.charge.status, "succeeded");

  const stats = await req("GET", "/api/dashboard/stats", {
    headers: { Cookie: cookieOf(login.setCookie) },
  });
  assert.equal(stats.data.user.plan, "pro");
  assert.equal(stats.data.usage.quota, 100000);
});

test("API key is required for the product API", async () => {
  const { res } = await req("POST", "/api/v1/data", { body: { value: "x" } });
  assert.equal(res.status, 401);
});

test("product API consumes quota and returns usage", async () => {
  const acct = await registerUser();
  const { res, data } = await req("POST", "/api/v1/data", {
    headers: { "X-API-Key": acct.data.user.apiKey },
    body: { value: { note: "first call" } },
  });
  assert.equal(res.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.usage.used, 1);
  assert.equal(data.usage.remaining, 999);
});

test("quota exhaustion returns 429 with a friendly message", async () => {
  db.prepare(
    "INSERT INTO plans (id, name, price_cents, monthly_quota, api_rate_max, features) VALUES ('tiny', 'Tiny', 0, 2, 1000, '[]')",
  ).run();

  const acct = await registerUser();
  db.prepare("UPDATE users SET plan_id = 'tiny' WHERE id = ?").run(acct.data.user.id);

  for (let i = 0; i < 2; i++) {
    const ok = await req("POST", "/api/v1/data", {
      headers: { "X-API-Key": acct.data.user.apiKey },
      body: {},
    });
    assert.equal(ok.res.status, 200);
  }
  const third = await req("POST", "/api/v1/data", {
    headers: { "X-API-Key": acct.data.user.apiKey },
    body: {},
  });
  assert.equal(third.res.status, 429);
  assert.equal(third.data.error.code, "quota_exceeded");

  db.prepare("UPDATE users SET plan_id = 'free' WHERE id = ?").run(acct.data.user.id);
  db.prepare("DELETE FROM plans WHERE id = 'tiny'").run();
});

test("logout clears the session cookie", async () => {
  const login = await req("POST", "/api/auth/login", {
    body: { email: user.email, password: user.password },
  });
  const { res } = await req("POST", "/api/auth/logout", {
    headers: { Cookie: cookieOf(login.setCookie) },
  });
  assert.equal(res.status, 200);
  const cleared = res.headers.get("set-cookie");
  assert.match(cleared, /token=;/);
  assert.match(cleared, /Max-Age=0|Expires=Thu, 01 Jan 1970/);
});

test("unknown routes return 404 JSON", async () => {
  const { res, data } = await req("GET", "/api/nope");
  assert.equal(res.status, 404);
  assert.equal(data.error.code, "not_found");
});

test("auth endpoints are rate limited", async () => {
  let last;
  for (let i = 0; i < 105; i++) {
    last = await req("POST", "/api/auth/login", {
      body: { email: "rate@example.com", password: "whatever" },
    });
  }
  assert.equal(last.res.status, 429);
});
