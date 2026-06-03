/**
 * In-memory questionnaire store.
 *
 * Prototype shortcut: persistence is in-process memory only.
 * Replace with a real database adapter when the prototype graduates.
 *
 * Traceability: shared by SUC-04, SUC-06, SUC-07, SUC-08, SUC-09, etc.
 */

import type { QuestionnaireRecord, QuestionnaireStatus } from "mediform-core";
import { randomUUID } from "crypto";

// ---------------------------------------------------------------------------
// Types
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
// Store implementation
// ---------------------------------------------------------------------------

const records = new Map<string, QuestionnaireRecord>();

/** Create a new questionnaire record in Draft status. */
export function createRecord(input: CreateRecordInput): QuestionnaireRecord {
  const now = new Date().toISOString();
  const record: QuestionnaireRecord = {
    id: randomUUID(),
    title: input.title,
    description: input.description,
    status: "draft",
    author: "staff",
    source: input.source,
    createdAt: now,
    lastModified: now,
  };
  records.set(record.id, record);
  return record;
}

/** Retrieve a record by ID. Returns undefined if not found. */
export function getRecord(id: string): QuestionnaireRecord | undefined {
  return records.get(id);
}

/** Update the source of an existing record. Bumps lastModified. */
export function updateSource(
  id: string,
  input: UpdateSourceInput
): QuestionnaireRecord | undefined {
  const record = records.get(id);
  if (!record) return undefined;
  const updated: QuestionnaireRecord = {
    ...record,
    source: input.source,
    title: input.title ?? record.title,
    description: input.description ?? record.description,
    lastModified: new Date().toISOString(),
  };
  records.set(id, updated);
  return updated;
}

/** Update the status of an existing record. */
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
  >
): QuestionnaireRecord | undefined {
  const record = records.get(id);
  if (!record) return undefined;
  const updated: QuestionnaireRecord = {
    ...record,
    status,
    lastModified: new Date().toISOString(),
    ...extra,
  };
  records.set(id, updated);
  return updated;
}

/** List all records, optionally filtered by status. */
export function listRecords(
  filter?: Partial<Pick<QuestionnaireRecord, "status">>
): QuestionnaireRecord[] {
  const all = Array.from(records.values());
  if (filter?.status) return all.filter((r) => r.status === filter.status);
  return all;
}

/**
 * Clear all records. Intended for use in tests only.
 */
export function _clearStore(): void {
  records.clear();
}
