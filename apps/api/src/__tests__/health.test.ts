/**
 * Integration test for the health endpoint.
 *
 * Traceability: SUC-N/A (infrastructure — no domain use case maps to /health).
 *
 * School: Chicago (state-based).
 * The health endpoint has no collaborators to mock; the interesting behaviour
 * is the HTTP response shape produced by the full Elysia request/response cycle.
 * app.handle() exercises routing, middleware, and serialisation in-process
 * without binding a real network socket.
 */

import { describe, expect, it } from "bun:test";
import { app } from "../index.js";

describe("GET /health", () => {
  it("returns 200 with { status: 'ok' }", async () => {
    // SUC-N/A: infrastructure smoke test
    const response = await app.handle(new Request("http://localhost/health"));

    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toEqual({ status: "ok" });
  });

  it("sets Content-Type to application/json", async () => {
    // SUC-N/A: verifies Elysia serialises the response correctly
    const response = await app.handle(new Request("http://localhost/health"));

    expect(response.headers.get("content-type")).toContain("application/json");
  });
});
