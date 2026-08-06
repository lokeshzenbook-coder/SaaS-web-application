import { Router } from "express";
import { db } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errors.js";

const router = Router();

router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const plan = db
      .prepare("SELECT id, name, price_cents, monthly_quota, features FROM plans")
      .all()
      .map((p) => ({ ...p, features: JSON.parse(p.features) }));

    const subscription = db
      .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
      .get(req.user.id);

    res.json({ plans: plan, current: subscription?.plan_id ?? req.user.plan_id });
  }),
);

export default router;
