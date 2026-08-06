import express from "express";
import path from "node:path";
import cookieParser from "cookie-parser";
import { ROOT_DIR } from "./config.js";
import { securityHeaders } from "./middleware/security.js";
import { globalRateLimit } from "./middleware/rateLimit.js";
import { notFound, errorHandler } from "./middleware/errors.js";
import authRoutes from "./routes/auth.js";
import plansRoutes from "./routes/plans.js";
import billingRoutes from "./routes/billing.js";
import dashboardRoutes from "./routes/dashboard.js";
import apiRoutes from "./routes/api.js";

export function createApp() {
  const app = express();

  app.disable("x-powered-by");
  app.use(express.json({ limit: "1mb" }));
  app.use(express.urlencoded({ extended: false }));
  app.use(cookieParser());
  app.use(securityHeaders);

  app.use("/healthz", (req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });

  app.use("/api/auth", globalRateLimit, authRoutes);
  app.use("/api/plans", plansRoutes);
  app.use("/api/billing", billingRoutes);
  app.use("/api/dashboard", dashboardRoutes);
  app.use("/api/v1", apiRoutes);

  app.use(express.static(path.join(ROOT_DIR, "public"), { extensions: ["html"] }));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
