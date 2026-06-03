/**
 * mediform API server entry point.
 *
 * Bootstraps the Elysia application. Routes are added incrementally
 * as stories are implemented (SUC-01 through SUC-14).
 *
 * The `App` type is exported for Eden Treaty clients in the frontend SPAs.
 */

import { Elysia } from "elysia";
import { patientRoutes } from "./routes/patient.js";
import { staffRoutes } from "./routes/staff.js";

const PORT = Number(Bun.env.PORT ?? 3000);

export const app = new Elysia()
	.get("/health", () => ({ status: "ok" }))
	.use(staffRoutes)
	.use(patientRoutes);

/** Eden Treaty type: import this in the frontend SPAs to get a type-safe client. */
export type App = typeof app;

app.listen(PORT, () => {
	console.log(`mediform API listening on http://localhost:${PORT}`);
});
