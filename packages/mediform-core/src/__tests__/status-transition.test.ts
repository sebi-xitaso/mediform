/**
 * London-school (interaction-based) TDD sample test.
 *
 * Traceability: SUC-N/A (TDD convention sample — foreshadows the lifecycle
 * manager used by SUC-07, SUC-09, SUC-12, SUC-13).
 *
 * Style rationale: StatusTransitionService orchestrates two collaborators
 * (QuestionnaireStore.findById and .save). The interesting behaviour is
 * *who gets called and with what*, not the internal state of the service.
 * London school: mock every collaborator, assert on interactions.
 *
 * Contrast with the Chicago-school sample in types.test.ts, which tests a
 * pure function with no collaborators.
 */

import { describe, expect, it, mock } from "bun:test";
import type { QuestionnaireStore } from "../store.js";
import {
  StatusTransitionError,
  StatusTransitionService,
} from "../status-transition.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRecord(
  status: Parameters<typeof StatusTransitionService.prototype.transition>[1],
) {
  return {
    id: "q-1",
    status,
    source: "---\ntitle: Test\n---",
    lastModified: new Date("2026-01-01"),
  };
}

function makeStore(
  record: Awaited<ReturnType<QuestionnaireStore["findById"]>>,
): QuestionnaireStore {
  return {
    findById: mock(async () => record),
    save: mock(async () => undefined),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("StatusTransitionService.transition", () => {
  it(
    // SUC-N/A: London-school sample — asserts collaborator interactions
    "calls store.findById with the given id",
    async () => {
      const record = makeRecord("draft");
      const store = makeStore(record);
      const svc = new StatusTransitionService(store);

      await svc.transition("q-1", "review");

      expect(store.findById).toHaveBeenCalledTimes(1);
      expect(store.findById).toHaveBeenCalledWith("q-1");
    },
  );

  it(
    // SUC-N/A: London-school sample — asserts save is called with updated status
    "calls store.save with the updated record when transition is valid",
    async () => {
      const record = makeRecord("draft");
      const store = makeStore(record);
      const svc = new StatusTransitionService(store);

      await svc.transition("q-1", "review");

      expect(store.save).toHaveBeenCalledTimes(1);
      expect(store.save).toHaveBeenCalledWith({ ...record, status: "review" });
    },
  );

  it(
    // SUC-N/A: London-school sample — asserts save is NOT called on not-found
    "does not call store.save when the questionnaire is not found",
    async () => {
      const store = makeStore(undefined);
      const svc = new StatusTransitionService(store);

      await expect(svc.transition("missing", "review")).rejects.toBeInstanceOf(
        StatusTransitionError,
      );

      expect(store.save).not.toHaveBeenCalled();
    },
  );

  it(
    // SUC-N/A: London-school sample — asserts save is NOT called on invalid transition
    "does not call store.save when the transition is not allowed",
    async () => {
      const record = makeRecord("published"); // published → draft is not allowed
      const store = makeStore(record);
      const svc = new StatusTransitionService(store);

      await expect(svc.transition("q-1", "draft")).rejects.toBeInstanceOf(
        StatusTransitionError,
      );

      expect(store.save).not.toHaveBeenCalled();
    },
  );
});
