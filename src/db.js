import { mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { config } from "./config.js";

mkdirSync(path.dirname(config.dbFile), { recursive: true });

export const db = new DatabaseSync(config.dbFile);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS plans (
    id            TEXT PRIMARY KEY,
    name          TEXT NOT NULL,
    price_cents   INTEGER NOT NULL,
    monthly_quota INTEGER NOT NULL,
    api_rate_max  INTEGER NOT NULL,
    features      TEXT NOT NULL DEFAULT '[]'
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    plan_id       TEXT NOT NULL DEFAULT 'free' REFERENCES plans(id),
    api_key       TEXT NOT NULL UNIQUE,
    status        TEXT NOT NULL DEFAULT 'active',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS subscriptions (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    plan_id       TEXT NOT NULL REFERENCES plans(id),
    status        TEXT NOT NULL DEFAULT 'active',
    current_period_end TEXT,
    created_at    TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usage (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    month     TEXT NOT NULL,
    count     INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, month)
  );
`);

const hasPlans = db.prepare("SELECT COUNT(*) AS n FROM plans").get().n > 0;
if (!hasPlans) {
  const insert = db.prepare(
    "INSERT INTO plans (id, name, price_cents, monthly_quota, api_rate_max, features) VALUES (?, ?, ?, ?, ?, ?)",
  );
  insert.run("free", "Free", 0, 1000, 10, JSON.stringify(["1k API calls/mo", "Community support"]));
  insert.run(
    "pro",
    "Pro",
    2900,
    100000,
    100,
    JSON.stringify(["100k API calls/mo", "Email support", "Rate limit boost"]),
  );
  insert.run(
    "enterprise",
    "Enterprise",
    14900,
    10000000,
    1000,
    JSON.stringify(["Unlimited calls", "SSO", "Priority support"]),
  );
}

export function getPlan(id) {
  return db.prepare("SELECT * FROM plans WHERE id = ?").get(id);
}

export function getUsageMonth(userId, month) {
  const row = db
    .prepare("SELECT count FROM usage WHERE user_id = ? AND month = ?")
    .get(userId, month);
  return row ? row.count : 0;
}

export function incrementUsage(userId, month) {
  db.prepare(
    `INSERT INTO usage (user_id, month, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, month) DO UPDATE SET count = count + 1`,
  ).run(userId, month);
}

export function currentMonth() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function closeDb() {
  db.close();
}
