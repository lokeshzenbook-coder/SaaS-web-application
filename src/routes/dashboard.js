import { Router } from "express";
import { db, getPlan, getUsageMonth, currentMonth } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/errors.js";

const router = Router();

router.get(
  "/stats",
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
    const plan = getPlan(user.plan_id);
    const month = currentMonth();
    const used = getUsageMonth(user.id, month);

    const subscription = db
      .prepare("SELECT * FROM subscriptions WHERE user_id = ?")
      .get(user.id);

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        plan: plan.id,
        planName: plan.name,
      },
      usage: {
        month,
        used,
        quota: plan.monthly_quota,
        remaining: Math.max(0, plan.monthly_quota - used),
        percent: plan.monthly_quota > 0 ? Math.round((used / plan.monthly_quota) * 100) : 0,
      },
      plan: {
        apiRateMax: plan.api_rate_max,
        features: JSON.parse(plan.features),
        priceCents: plan.price_cents,
      },
      subscription: subscription
        ? {
            status: subscription.status,
            currentPeriodEnd: subscription.current_period_end,
          }
        : null,
    });
  }),
);

export default router;
