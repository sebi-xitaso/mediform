/**
 * Core domain types for the mediform platform.
 *
 * These types are shared across apps/api, apps/patient, and apps/employee.
 * They represent the ubiquitous language of the domain.
 */

// ---------------------------------------------------------------------------
// Questionnaire lifecycle
// ---------------------------------------------------------------------------

export type QuestionnaireStatus =
  | "draft"
  | "review"
  | "approved"
  | "published"
  | "rejected"
  | "retired";

// ---------------------------------------------------------------------------
// .mediform format — parsed representation
// ---------------------------------------------------------------------------

export type MapsToType =
  | "boolean"
  | "integer"
  | "decimal"
  | "string"
  | "date"
  | "Coding"
  | "Quantity";

export type QuestionType =
  | "boolean"
  | "integer"
  | "decimal"
  | "string"
  | "date"
  | "choice"
  | "scale"
  | "custom";

export interface AnswerOption {
  label: string;
  /** SNOMED code in the form "SNOMED:<code>" */
  snomedCode?: string;
}

export interface ParsedQuestion {
  id: string;
  title: string;
  description?: string;
  type: QuestionType;
  mapsTo: MapsToType;
  required: boolean;
  loinc?: string;
  options?: AnswerOption[];
  /** Renderer JS source for type === "custom" */
  renderer?: string;
  /** For type === "scale" */
  min?: number;
  max?: number;
  step?: number;
}

export interface ParsedSection {
  title: string | null;
  questions: ParsedQuestion[];
}

export interface ParsedQuestionnaireFrontmatter {
  title: string;
  description?: string;
  version: string;
  status: QuestionnaireStatus;
}

export interface ParsedQuestionnaire {
  frontmatter: ParsedQuestionnaireFrontmatter;
  sections: ParsedSection[];
}

// ---------------------------------------------------------------------------
// Parse / compile errors
// ---------------------------------------------------------------------------

export interface ParseError {
  line: number;
  column?: number;
  message: string;
}

export interface ParseWarning {
  line?: number;
  message: string;
}

export interface CompileError {
  questionId?: string;
  field?: string;
  message: string;
}

// ---------------------------------------------------------------------------
// FHIR resource types (minimal subset needed for the prototype)
// ---------------------------------------------------------------------------

export type FHIRQuestionnaireStatus =
  | "draft"
  | "active"
  | "retired"
  | "unknown";

export interface FHIRCoding {
  system?: string;
  code: string;
  display?: string;
}

export interface FHIRAnswerOption {
  valueCoding?: FHIRCoding;
  valueString?: string;
}

export interface FHIRQuestionnaireItem {
  linkId: string;
  text?: string;
  type: string;
  required?: boolean;
  code?: FHIRCoding[];
  answerOption?: FHIRAnswerOption[];
  item?: FHIRQuestionnaireItem[];
}

export interface FHIRQuestionnaire {
  resourceType: "Questionnaire";
  id?: string;
  title?: string;
  description?: string;
  status: FHIRQuestionnaireStatus;
  version?: string;
  item?: FHIRQuestionnaireItem[];
}

export interface CompileWarning {
  questionId?: string;
  field: string;
  message: string;
}

export interface CompileResult {
  success: boolean;
  fhirQuestionnaire?: FHIRQuestionnaire;
  errors: CompileError[];
  warnings: CompileWarning[];
}

// ---------------------------------------------------------------------------
// Questionnaire store record
// ---------------------------------------------------------------------------

export interface QuestionnaireRecord {
  id: string;
  title: string;
  description?: string;
  status: QuestionnaireStatus;
  /** Prototype shortcut: no auth, so author is always "staff". */
  author: string;
  source: string;
  createdAt: string;
  lastModified: string;
  reviewFeedback?: string;
  rejectionReason?: string;
  patientLink?: string;
  fhirQuestionnaireId?: string;
}

// ---------------------------------------------------------------------------
// Patient-facing questionnaire shape (SUC-01 / SUC-05 output)
// ---------------------------------------------------------------------------

export interface PatientQuestion {
  id: string;
  title: string;
  description?: string;
  type: QuestionType;
  required: boolean;
  config: Record<string, unknown>;
  renderer?: string;
}

export interface PatientSection {
  title: string | null;
  questions: PatientQuestion[];
}

export interface PatientQuestionnaire {
  id: string;
  title: string;
  description?: string;
  sections: PatientSection[];
}

// ---------------------------------------------------------------------------
// Metadata warnings (SUC-04 / SUC-06 output)
// ---------------------------------------------------------------------------

export interface MetadataWarning {
  questionId?: string;
  field: string;
  message: string;
}
