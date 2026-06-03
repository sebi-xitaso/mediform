/**
 * mediform API server entry point.
 *
 * Bootstraps the Elysia application. Routes are added incrementally
 * as stories are implemented (SUC-01 through SUC-14).
 */

import { Elysia } from "elysia";
import { staffRoutes } from "./routes/staff.js";
import { patientRoutes } from "./routes/patient.js";

const PORT = Number(Bun.env["PORT"] ?? 3000);

export const app = new Elysia()
  .get("/health", () => ({ status: "ok" }))
  .use(staffRoutes)
  .use(patientRoutes);

app.listen(PORT, () => {
  console.log(`mediform API listening on http://localhost:${PORT}`);
});
