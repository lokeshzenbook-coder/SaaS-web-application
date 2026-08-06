import { Router } from "express";
import bcrypt from "bcryptjs";
import { db, getPlan } from "../db.js";
import { config } from "../config.js";
import { signToken, requireAuth } from "../middleware/auth.js";
import { asyncHandler, ApiError } from "../middleware/errors.js";
import { email, stringOf } from "../utils/validate.js";
import { generateApiKey } from "../utils/apiKey.js";

const router = Router();

const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: "lax",
  secure: config.env === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
  path: "/",
};

router.post(
  "/register",
  asyncHandler(async (req, res) => {
    const name = stringOf(req.body, "name", { min: 1, max: 80 });
    const mail = email(req.body);
    const password = stringOf(req.body, "password", { min: 8, max: 128 });

    const exists = db.prepare("SELECT id FROM users WHERE email = ?").get(mail);
    if (exists) {
      throw new ApiError(409, "An account with this email already exists", "email_taken");
    }

    const passwordHash = await bcrypt.hash(password, config.bcryptRounds);
    const apiKey = generateApiKey();

    const result = db
      .prepare(
        "INSERT INTO users (email, name, password_hash, plan_id, api_key) VALUES (?, ?, ?, 'free', ?)",
      )
      .run(mail, name, passwordHash, apiKey);

    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(result.lastInsertRowid);

    res.cookie("token", signToken(user), COOKIE_OPTS);
    res.status(201).json({ user: publicUser(user) });
  }),
);

router.post(
  "/login",
  asyncHandler(async (req, res) => {
    const mail = email(req.body);
    const password = stringOf(req.body, "password", { min: 1, max: 128 });

    const user = db.prepare("SELECT * FROM users WHERE email = ?").get(mail);
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new ApiError(401, "Invalid email or password", "invalid_credentials");
    }
    if (user.status !== "active") {
      throw new ApiError(403, "Account is disabled", "account_disabled");
    }

    res.cookie("token", signToken(user), COOKIE_OPTS);
    res.json({ user: publicUser(user) });
  }),
);

router.post("/logout", (req, res) => {
  res.clearCookie("token", { path: "/" });
  res.json({ ok: true });
});

router.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    res.json({ user: publicUser(user) });
  }),
);

export function publicUser(user) {
  const plan = getPlan(user.plan_id);
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    plan: plan ? plan.id : "free",
    planName: plan?.name ?? null,
    apiKey: user.api_key,
    status: user.status,
    createdAt: user.created_at,
  };
}

export { COOKIE_OPTS };
export default router;
