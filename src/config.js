import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.join(__dirname, "..");
export const DATA_DIR = path.join(ROOT_DIR, "data");

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  env: process.env.NODE_ENV ?? "development",
  port: toInt(process.env.PORT, 3000),
  host: process.env.HOST ?? "0.0.0.0",
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-secret-change-me",
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "7d",
  dbFile: process.env.DB_FILE ?? path.join(DATA_DIR, "saas.db"),
  bcryptRounds: toInt(process.env.BCRYPT_ROUNDS, 10),
  rateLimit: {
    windowMs: toInt(process.env.RATE_WINDOW_MS, 60_000),
    limit: toInt(process.env.RATE_LIMIT_MAX, 100),
  },
};
