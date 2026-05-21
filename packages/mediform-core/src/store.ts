/**
 * QuestionnaireStore interface.
 *
 * Abstracts persistence of questionnaire lifecycle records.
 * Implementations live in apps/api (SQLite via bun:sqlite).
 * The interface lives here so mediform-core can define domain
 * services without depending on any infrastructure package.
 */

import type { QuestionnaireStatus } from "./types.js";

export interface QuestionnaireRecord {
  id: string;
  status: QuestionnaireStatus;
  source: string;
  lastModified: Date;
}

export interface QuestionnaireStore {
  findById(id: string): Promise<QuestionnaireRecord | undefined>;
  save(record: QuestionnaireRecord): Promise<void>;
}
