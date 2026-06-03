/**
 * Type-safe API client for the employee SPA.
 *
 * Uses Eden Treaty to derive the client type from the Elysia App definition.
 * All API calls made from this app should go through this client so that
 * contract changes are caught at compile time (ADR-007, #68).
 *
 * Usage:
 *   import { api } from "./api-client.js";
 *   const { data } = await api.health.get();
 *   const { data: list } = await api.staff.questionnaires.get();
 */

import { treaty } from "@elysiajs/eden";
import type { App } from "api/types";

const API_BASE = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export const api: ReturnType<typeof treaty<App>> = treaty<App>(API_BASE);
