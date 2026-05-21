/**
 * mediform API server entry point.
 *
 * Bootstraps the Elysia application. Routes are added incrementally
 * as stories are implemented (SUC-01 through SUC-14).
 */

import { Elysia } from "elysia";

const PORT = Number(Bun.env["PORT"] ?? 3000);

export const app = new Elysia()
  .get("/health", () => ({ status: "ok" }));

app.listen(PORT, () => {
  console.log(`mediform API listening on http://localhost:${PORT}`);
});
