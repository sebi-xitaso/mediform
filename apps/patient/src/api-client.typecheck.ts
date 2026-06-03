/**
 * Compile-time type-safety test for Eden Treaty client (ADR-007, #68).
 *
 * This file is never executed at runtime — it exists only to give
 * `tsc --noEmit` something to verify. If the `/health` endpoint signature
 * changes (e.g., the response shape is no longer `{ status: string }`),
 * the assignment below will produce a compile error.
 *
 * Style: static type assertion (no test runner needed).
 */

import { api } from "./api-client.js";

// Verify that the return type of GET /health is inferred correctly.
// `data` must be assignable to `{ status: string } | null`.
async function checkHealth(): Promise<{ status: string } | null> {
	const { data } = await api.health.get();
	return data;
}

// Suppress "unused variable" warnings — the function only needs to typecheck.
void checkHealth;
