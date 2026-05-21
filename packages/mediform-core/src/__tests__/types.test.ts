/**
 * Chicago-school (state-based) TDD sample test.
 *
 * Traceability: no specific SUC — this test exists to prove the test runner
 * is wired up and the TypeScript strict baseline compiles correctly.
 *
 * Style rationale: pure-function tests need no mocks; asserting the returned
 * value is sufficient. London-style mocking would add noise without benefit.
 */

import { describe, expect, it } from "bun:test";
import type { QuestionnaireStatus } from "../types.js";

// ---------------------------------------------------------------------------
// Subject under test: a trivial domain helper used to verify the workspace
// ---------------------------------------------------------------------------

const TERMINAL_STATUSES: ReadonlySet<QuestionnaireStatus> = new Set([
  "rejected",
  "retired",
]);

function isTerminalStatus(status: QuestionnaireStatus): boolean {
  return TERMINAL_STATUSES.has(status);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("isTerminalStatus", () => {
  it("returns true for rejected status", () => {
    expect(isTerminalStatus("rejected")).toBe(true);
  });

  it("returns true for retired status", () => {
    expect(isTerminalStatus("retired")).toBe(true);
  });

  it("returns false for draft status", () => {
    expect(isTerminalStatus("draft")).toBe(false);
  });

  it("returns false for review status", () => {
    expect(isTerminalStatus("review")).toBe(false);
  });

  it("returns false for approved status", () => {
    expect(isTerminalStatus("approved")).toBe(false);
  });

  it("returns false for published status", () => {
    expect(isTerminalStatus("published")).toBe(false);
  });
});
