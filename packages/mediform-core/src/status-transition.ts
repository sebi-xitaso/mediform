/**
 * StatusTransitionService
 *
 * Validates and applies questionnaire lifecycle status transitions.
 * Orchestrates two collaborators: QuestionnaireStore.findById and .save.
 *
 * This is the domain service that enforces the lifecycle state machine:
 *
 *   draft → review
 *   review → approved | draft | rejected
 *   approved → published | draft
 *   published → retired
 *
 * Used as the London-school TDD sample (see __tests__/status-transition.test.ts).
 * The full lifecycle manager for SUC-07, SUC-09, SUC-12, SUC-13 will extend
 * this pattern with quality-check integration and FHIR side-effects.
 */

import type { QuestionnaireStatus } from "./types.js";
import type { QuestionnaireStore } from "./store.js";

// ---------------------------------------------------------------------------
// Allowed transitions
// ---------------------------------------------------------------------------

const ALLOWED: Partial<Record<QuestionnaireStatus, ReadonlySet<QuestionnaireStatus>>> = {
  draft:     new Set<QuestionnaireStatus>(["review"]),
  review:    new Set<QuestionnaireStatus>(["approved", "draft", "rejected"]),
  approved:  new Set<QuestionnaireStatus>(["published", "draft"]),
  published: new Set<QuestionnaireStatus>(["retired"]),
};

// ---------------------------------------------------------------------------
// Error
// ---------------------------------------------------------------------------

export class StatusTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StatusTransitionError";
  }
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class StatusTransitionService {
  constructor(private readonly store: QuestionnaireStore) {}

  /**
   * Transition a questionnaire to a new status.
   *
   * @throws {StatusTransitionError} if the questionnaire is not found or the
   *   transition is not allowed by the lifecycle state machine.
   */
  async transition(id: string, to: QuestionnaireStatus): Promise<void> {
    const record = await this.store.findById(id);

    if (record === undefined) {
      throw new StatusTransitionError(
        `Questionnaire "${id}" not found.`,
      );
    }

    const allowed = ALLOWED[record.status];
    if (allowed === undefined || !allowed.has(to)) {
      throw new StatusTransitionError(
        `Transition from "${record.status}" to "${to}" is not allowed.`,
      );
    }

    await this.store.save({ ...record, status: to });
  }
}
