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
