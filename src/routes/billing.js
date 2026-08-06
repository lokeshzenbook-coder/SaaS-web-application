import { Router } from "express";
import { db, getPlan } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { asyncHandler, ApiError } from "../middleware/errors.js";
import { stringOf } from "../utils/validate.js";

const router = Router();

const DAYS_PER_PERIOD = 30;
const PAYMENT_METHODS = ["card", "paypal", "wire"];

function mockCharge(plan, userId) {
  return {
    id: `ch_${Math.random().toString(36).slice(2, 12)}`,
    userId,
    planId: plan.id,
    amountCents: plan.price_cents,
    currency: "usd",
    status: "succeeded",
    chargedAt: new Date().toISOString(),
  };
}

router.post(
  "/subscribe",
  requireAuth,
  asyncHandler(async (req, res) => {
    const planId = stringOf(req.body, "plan_id", { min: 1, max: 40 });
    const paymentMethod = req.body.payment_method ?? "card";
    if (!PAYMENT_METHODS.includes(paymentMethod)) {
      throw new ApiError(400, "Unsupported payment method", "bad_payment_method");
    }

    const plan = getPlan(planId);
    if (!plan) {
      throw new ApiError(404, "Unknown plan", "unknown_plan");
    }

    const periodEnd = new Date(Date.now() + DAYS_PER_PERIOD * 24 * 60 * 60 * 1000).toISOString();
    const charge = mockCharge(plan, req.user.id);

    db.prepare(
      `INSERT INTO subscriptions (user_id, plan_id, status, current_period_end)
       VALUES (?, ?, 'active', ?)
       ON CONFLICT(user_id) DO UPDATE SET
         plan_id = excluded.plan_id,
         status = 'active',
         current_period_end = excluded.current_period_end,
         updated_at = datetime('now')`,
    ).run(req.user.id, planId, periodEnd);

    db.prepare("UPDATE users SET plan_id = ? WHERE id = ?").run(planId, req.user.id);

    res.json({
      subscription: {
        planId,
        status: "active",
        currentPeriodEnd: periodEnd,
        priceCents: plan.price_cents,
      },
      charge,
      note: "Mock payment — connect a real provider (e.g. Stripe) for production.",
    });
  }),
);

router.delete(
  "/subscribe",
  requireAuth,
  asyncHandler(async (req, res) => {
    db.prepare("DELETE FROM subscriptions WHERE user_id = ?").run(req.user.id);
    db.prepare("UPDATE users SET plan_id = 'free' WHERE id = ?").run(req.user.id);
    res.json({ ok: true, planId: "free" });
  }),
);

export default router;
