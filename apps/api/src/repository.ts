/**
 * Questionnaire repository interface and SQLite implementation.
 *
 * Traceability: ADR-009, #67.
 */

import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import type { QuestionnaireRecord, QuestionnaireStatus } from "mediform-core";
import type { CreateRecordInput, UpdateSourceInput } from "./store.js";

// ---------------------------------------------------------------------------
// Repository interface
// ---------------------------------------------------------------------------

export interface QuestionnaireRepository {
	create(input: CreateRecordInput): QuestionnaireRecord;
	getById(id: string): QuestionnaireRecord | undefined;
	update(id: string, input: UpdateSourceInput): QuestionnaireRecord | undefined;
	updateStatus(
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
	): QuestionnaireRecord | undefined;
	list(statuses?: QuestionnaireStatus[]): QuestionnaireRecord[];
	/** Remove all records. Intended for use in tests only. */
	clear(): void;
}

// ---------------------------------------------------------------------------
// SQLite row → domain type
// ---------------------------------------------------------------------------

interface Row {
	id: string;
	title: string;
	description: string | null;
	status: string;
	author: string;
	source: string;
	created_at: string;
	last_modified: string;
	review_feedback: string | null;
	rejection_reason: string | null;
	patient_link: string | null;
	fhir_questionnaire_id: string | null;
}

function toRecord(row: Row): QuestionnaireRecord {
	const record: QuestionnaireRecord = {
		id: row.id,
		title: row.title,
		status: row.status as QuestionnaireStatus,
		author: row.author,
		source: row.source,
		createdAt: row.created_at,
		lastModified: row.last_modified,
	};
	if (row.description !== null) record.description = row.description;
	if (row.review_feedback !== null) record.reviewFeedback = row.review_feedback;
	if (row.rejection_reason !== null)
		record.rejectionReason = row.rejection_reason;
	if (row.patient_link !== null) record.patientLink = row.patient_link;
	if (row.fhir_questionnaire_id !== null)
		record.fhirQuestionnaireId = row.fhir_questionnaire_id;
	return record;
}

// ---------------------------------------------------------------------------
// SQLite implementation
// ---------------------------------------------------------------------------

const SCHEMA = `
CREATE TABLE IF NOT EXISTS questionnaires (
  id                   TEXT PRIMARY KEY,
  title                TEXT NOT NULL,
  description          TEXT,
  status               TEXT NOT NULL,
  author               TEXT NOT NULL,
  source               TEXT NOT NULL,
  created_at           TEXT NOT NULL,
  last_modified        TEXT NOT NULL,
  review_feedback      TEXT,
  rejection_reason     TEXT,
  patient_link         TEXT,
  fhir_questionnaire_id TEXT
);
`;

export class SqliteQuestionnaireRepository implements QuestionnaireRepository {
	private readonly db: Database;

	constructor(path: string = ":memory:") {
		this.db = new Database(path);
		this.db.exec(SCHEMA);
	}

	create(input: CreateRecordInput): QuestionnaireRecord {
		const now = new Date().toISOString();
		const id = randomUUID();
		this.db
			.prepare(
				`INSERT INTO questionnaires
           (id, title, description, status, author, source, created_at, last_modified)
         VALUES (?, ?, ?, 'draft', 'staff', ?, ?, ?)`,
			)
			.run(id, input.title, input.description ?? null, input.source, now, now);
		return this.getById(id) as QuestionnaireRecord;
	}

	getById(id: string): QuestionnaireRecord | undefined {
		const row = this.db
			.prepare("SELECT * FROM questionnaires WHERE id = ?")
			.get(id) as Row | null;
		return row ? toRecord(row) : undefined;
	}

	update(
		id: string,
		input: UpdateSourceInput,
	): QuestionnaireRecord | undefined {
		const existing = this.getById(id);
		if (!existing) return undefined;
		const now = new Date().toISOString();
		this.db
			.prepare(
				`UPDATE questionnaires
         SET source = ?, title = ?, description = ?, last_modified = ?
         WHERE id = ?`,
			)
			.run(
				input.source,
				input.title ?? existing.title,
				input.description ?? existing.description ?? null,
				now,
				id,
			);
		return this.getById(id);
	}

	updateStatus(
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
		const existing = this.getById(id);
		if (!existing) return undefined;
		const now = new Date().toISOString();
		this.db
			.prepare(
				`UPDATE questionnaires
         SET status = ?, last_modified = ?,
             review_feedback       = ?,
             rejection_reason      = ?,
             patient_link          = ?,
             fhir_questionnaire_id = ?
         WHERE id = ?`,
			)
			.run(
				status,
				now,
				extra?.reviewFeedback ?? existing.reviewFeedback ?? null,
				extra?.rejectionReason ?? existing.rejectionReason ?? null,
				extra?.patientLink ?? existing.patientLink ?? null,
				extra?.fhirQuestionnaireId ?? existing.fhirQuestionnaireId ?? null,
				id,
			);
		return this.getById(id);
	}

	list(statuses?: QuestionnaireStatus[]): QuestionnaireRecord[] {
		let rows: Row[];
		if (statuses && statuses.length > 0) {
			const placeholders = statuses.map(() => "?").join(", ");
			rows = this.db
				.prepare(
					`SELECT * FROM questionnaires WHERE status IN (${placeholders})`,
				)
				.all(...statuses) as Row[];
		} else {
			rows = this.db.prepare("SELECT * FROM questionnaires").all() as Row[];
		}
		return rows.map(toRecord).sort((a, b) => {
			// Review items first (BR-035)
			const aReview = a.status === "review" ? 0 : 1;
			const bReview = b.status === "review" ? 0 : 1;
			if (aReview !== bReview) return aReview - bReview;
			// Then by lastModified descending
			return (
				new Date(b.lastModified).getTime() - new Date(a.lastModified).getTime()
			);
		});
	}

	clear(): void {
		this.db.exec("DELETE FROM questionnaires");
	}
}
