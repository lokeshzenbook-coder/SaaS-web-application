import jwt from "jsonwebtoken";
import { db } from "../db.js";
import { config } from "../config.js";
import { ApiError } from "./errors.js";

export function signToken(user) {
  return jwt.sign({ sub: String(user.id), email: user.email }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn,
  });
}

function loadUser(id) {
  const user = db
    .prepare(
      `SELECT u.id, u.email, u.name, u.plan_id, u.api_key, u.status, u.created_at
       FROM users u WHERE u.id = ?`,
    )
    .get(id);
  return user;
}

function unauthorized(res, message) {
  throw new ApiError(401, message ?? "Authentication required", "unauthorized");
}

export function requireAuth(req, _res, next) {
  try {
    const token = req.cookies?.token ?? extractBearer(req);
    if (!token) {
      unauthorized();
    }
    const payload = jwt.verify(token, config.jwtSecret);
    const user = loadUser(Number(payload.sub));
    if (!user || user.status !== "active") {
      unauthorized("Account is not active");
    }
    req.user = user;
    next();
  } catch (err) {
    if (err instanceof ApiError) return next(err);
    next(new ApiError(401, "Invalid or expired session", "invalid_token"));
  }
}

export function requireApiKey(req, _res, next) {
  try {
    const key = req.headers["x-api-key"];
    if (!key) {
      throw new ApiError(401, "Missing X-API-Key header", "missing_api_key");
    }
    const user = db.prepare("SELECT * FROM users WHERE api_key = ?").get(key);
    if (!user || user.status !== "active") {
      throw new ApiError(401, "Invalid API key", "invalid_api_key");
    }
    req.user = user;
    req.usedApiKey = true;
    next();
  } catch (err) {
    next(err);
  }
}

function extractBearer(req) {
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  return null;
}
