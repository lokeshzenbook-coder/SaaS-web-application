import { Router } from "express";
import { getPlan, getUsageMonth, incrementUsage, currentMonth } from "../db.js";
import { requireApiKey } from "../middleware/auth.js";
import { asyncHandler, ApiError } from "../middleware/errors.js";
import { rateLimit } from "../middleware/rateLimit.js";

const router = Router();

router.use(requireApiKey);

router.get("/echo", (req, res) => {
  res.json({
    service: "saas-web-application",
    version: "v1",
    echo: {
      path: req.query.path ?? null,
      q: req.query.q ?? null,
    },
    timestamp: new Date().toISOString(),
  });
});

const perUserRateLimit = rateLimit({
  windowMs: 60_000,
  limit: 1000,
  key: (req) => `api:${req.user.id}`,
});

router.post(
  "/data",
  perUserRateLimit,
  asyncHandler(async (req, res) => {
    const user = req.user;
    const plan = getPlan(user.plan_id);
    const month = currentMonth();
    const used = getUsageMonth(user.id, month);

    if (used >= plan.monthly_quota) {
      throw new ApiError(
        429,
        `Monthly quota exceeded (${used}/${plan.monthly_quota}). Upgrade your plan.`,
        "quota_exceeded",
      );
    }

    incrementUsage(user.id, month);

    res.json({
      ok: true,
      usage: {
        month,
        used: used + 1,
        quota: plan.monthly_quota,
        remaining: Math.max(0, plan.monthly_quota - used - 1),
      },
      data: {
        id: `rec_${Math.random().toString(36).slice(2, 14)}`,
        value: req.body?.value ?? null,
        processedBy: "saas-worker",
      },
    });
  }),
);

export default router;
