/**
 * Health route plugin.
 *
 * Exposes GET /health so load-balancers and smoke tests can verify the
 * process is alive without touching any domain logic.
 */

import { Elysia } from "elysia";

export const healthRoutes = new Elysia().get("/health", () => ({
  status: "ok",
}));
