/**
 * mediform API server entry point.
 *
 * Bootstraps the Elysia application and registers route plugins.
 * Routes are added incrementally as stories are implemented (SUC-01 through SUC-14).
 *
 * Module layout:
 *   routes/     — Elysia route plugins, one file per resource group
 *   services/   — domain service interfaces and implementations
 *   adapters/   — external system adapters (FHIR client, SQLite store)
 */

import { Elysia } from "elysia";
import { healthRoutes } from "./routes/health.js";

export const app = new Elysia().use(healthRoutes);

const PORT = Number(Bun.env["PORT"] ?? 3000);

app.listen(PORT, () => {
  console.log(`mediform API listening on http://localhost:${PORT}`);
});
