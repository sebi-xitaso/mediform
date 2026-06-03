/**
 * Questionnaire store — thin facade over SqliteQuestionnaireRepository.
 *
 * Dev server: uses file-based SQLite at DATABASE_PATH (defaults to mediform.db).
 * Tests: set DATABASE_PATH=:memory: or leave unset for in-process memory DB.
 *
 * Traceability: ADR-009, #67.
 */

import type { QuestionnaireRecord, QuestionnaireStatus, QualityCheckResponse } from "mediform-core";
import { SqliteQuestionnaireRepository } from "./repository.js";

// ---------------------------------------------------------------------------
// Types (re-exported so existing import sites keep working)
// ---------------------------------------------------------------------------

export interface CreateRecordInput {
	title: string;
	description?: string;
	source: string;
}

export interface UpdateSourceInput {
	source: string;
	title?: string;
	description?: string;
}

// ---------------------------------------------------------------------------
// Singleton repository
// ---------------------------------------------------------------------------

const dbPath = Bun.env.DATABASE_PATH ?? ":memory:";
const repo = new SqliteQuestionnaireRepository(dbPath);

// ---------------------------------------------------------------------------
// Public API (same surface as the previous in-memory store)
// ---------------------------------------------------------------------------

/** Create a new questionnaire record in Draft status. */
export function createRecord(input: CreateRecordInput): QuestionnaireRecord {
	return repo.create(input);
}

/** Retrieve a record by ID. Returns undefined if not found. */
export function getRecord(id: string): QuestionnaireRecord | undefined {
	return repo.getById(id);
}

/** Update the source of an existing record. Bumps lastModified. */
export function updateSource(
	id: string,
	input: UpdateSourceInput,
): QuestionnaireRecord | undefined {
	return repo.update(id, input);
}

/** Update the status (and optional extra fields) of an existing record. */
export function updateStatus(
	id: string,
	status: QuestionnaireStatus,
	extra?: Partial<
		Pick<
			QuestionnaireRecord,
			| "reviewFeedback"
			| "rejectionReason"
			| "patientLink"
			| "fhirQuestionnaireId"
		>
	>,
): QuestionnaireRecord | undefined {
	return repo.updateStatus(id, status, extra);
}

/** List all records, optionally filtered by one or more statuses (BR-035). */
export function listRecords(
	statuses?: QuestionnaireStatus[],
): QuestionnaireRecord[] {
	return repo.list(statuses);
}

/**
 * Remove all records. Intended for use in tests only.
 */
export function _clearStore(): void {
	repo.clear();
}

/** Persist the latest quality-check result for a questionnaire (#53). */
export function saveQualityCheck(
	questionnaireId: string,
	result: QualityCheckResponse,
): void {
	repo.saveQualityCheck(questionnaireId, result);
}

/** Retrieve the latest quality-check result for a questionnaire (#53). */
export function getQualityCheck(
	questionnaireId: string,
): QualityCheckResponse | undefined {
	return repo.getQualityCheck(questionnaireId);
}
