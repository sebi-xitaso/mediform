/**
 * Patient-answer → FHIR QuestionnaireResponse + Observation compiler (SUC-11).
 *
 * Maps a list of patient answers against the parsed questionnaire to produce:
 *  - A FHIR QuestionnaireResponse resource
 *  - A FHIR Observation for each answered question that carries a LOINC code
 *
 * Traceability: issue #16, SUC-11, NFR-16.
 */

import type {
  Answer,
  ParsedQuestionnaire,
  ParsedQuestion,
  MapsToType,
  FHIRCoding,
  FHIRObservation,
  FHIRQuestionnaireResponse,
  FHIRQuestionnaireResponseItem,
  CompileResponseError,
  CompileResponseResult,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface CompileResponseInput {
  /** The parsed questionnaire describing each question's type. */
  questionnaire: ParsedQuestionnaire;
  /** Flat list of answers keyed by questionId. */
  answers: Answer[];
  /**
   * FHIR Questionnaire canonical reference (e.g. "Questionnaire/abc123").
   * May be omitted for unit tests / pre-publish previews.
   */
  fhirQuestionnaireRef?: string;
}

/**
 * Compile patient answers to a FHIR QuestionnaireResponse plus derived
 * Observation resources. Always returns a result; never throws.
 */
export function compileResponse(
  input: CompileResponseInput
): CompileResponseResult {
  const { questionnaire, answers, fhirQuestionnaireRef } = input;
  const errors: CompileResponseError[] = [];
  const observations: FHIRObservation[] = [];

  // Build a flat lookup: questionId → ParsedQuestion
  const questionIndex = buildQuestionIndex(questionnaire);

  const responseResponseId = `qr-${Date.now()}`;
  const responseRef = `QuestionnaireResponse/${responseResponseId}`;

  const items: FHIRQuestionnaireResponseItem[] = [];

  for (const answer of answers) {
    const question = questionIndex.get(answer.questionId);

    if (!question) {
      errors.push({
        questionId: answer.questionId,
        message: `No question with id "${answer.questionId}" found in questionnaire.`,
      });
      continue;
    }

    // Map value according to maps-to type
    const mapped = mapValue(answer.value, question.mapsTo);
    if (mapped.error) {
      errors.push({ questionId: answer.questionId, message: mapped.error });
      // Still produce a response item with the raw value as fallback
    }

    items.push({
      linkId: question.id,
      answer: [{ value: mapped.value ?? answer.value }],
    });

    // Produce Observation if question has a LOINC code
    if (question.loinc) {
      const obs = buildObservation(
        question,
        mapped.value ?? answer.value,
        responseRef
      );
      observations.push(obs);
    }
  }

  const questionnaireResponse: FHIRQuestionnaireResponse = {
    resourceType: "QuestionnaireResponse",
    id: responseResponseId,
    questionnaire: fhirQuestionnaireRef,
    status: "completed",
    authored: new Date().toISOString(),
    item: items,
  };

  return { questionnaireResponse, observations, errors };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function buildQuestionIndex(
  questionnaire: ParsedQuestionnaire
): Map<string, ParsedQuestion> {
  const index = new Map<string, ParsedQuestion>();
  for (const section of questionnaire.sections) {
    for (const q of section.questions) {
      index.set(q.id, q);
    }
  }
  return index;
}

interface MappedValue {
  value?: unknown;
  error?: string;
}

function mapValue(raw: unknown, mapsTo: MapsToType): MappedValue {
  if (raw === null || raw === undefined) return { value: null };

  switch (mapsTo) {
    case "boolean": {
      if (typeof raw === "boolean") return { value: raw };
      if (raw === "true") return { value: true };
      if (raw === "false") return { value: false };
      return { error: `Expected boolean, got ${typeof raw} (${raw})` };
    }
    case "integer": {
      const n = Number(raw);
      if (!Number.isNaN(n) && Number.isInteger(n)) return { value: n };
      return { error: `Expected integer, got ${raw}` };
    }
    case "decimal": {
      const n = Number(raw);
      if (!Number.isNaN(n)) return { value: n };
      return { error: `Expected decimal, got ${raw}` };
    }
    case "string":
      return { value: String(raw) };
    case "date": {
      if (typeof raw === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw))
        return { value: raw };
      return { error: `Expected date string (YYYY-MM-DD), got ${raw}` };
    }
    case "Coding": {
      if (
        typeof raw === "object" &&
        raw !== null &&
        "code" in raw
      )
        return { value: raw };
      return { error: `Expected Coding object with code field, got ${JSON.stringify(raw)}` };
    }
    case "Quantity": {
      if (
        typeof raw === "object" &&
        raw !== null &&
        "value" in raw
      )
        return { value: raw };
      return { error: `Expected Quantity object with value field, got ${JSON.stringify(raw)}` };
    }
    default:
      return { value: raw };
  }
}

function buildObservation(
  question: ParsedQuestion,
  value: unknown,
  derivedFromRef: string
): FHIRObservation {
  const obs: FHIRObservation = {
    resourceType: "Observation",
    status: "final",
    code: {
      coding: [
        {
          system: "http://loinc.org",
          code: question.loinc!,
        },
      ],
    },
    derivedFrom: [{ reference: derivedFromRef }],
  };

  // Assign the correct FHIR value[x] field based on maps-to
  switch (question.mapsTo) {
    case "boolean":
      obs.valueBoolean = value as boolean;
      break;
    case "integer":
    case "decimal":
      if (question.mapsTo === "integer") {
        obs.valueInteger = value as number;
      } else {
        obs.valueDecimal = value as number;
      }
      break;
    case "string":
      obs.valueString = value as string;
      break;
    case "date":
      obs.valueString = value as string;
      break;
    case "Coding":
      obs.valueCoding = value as FHIRCoding;
      break;
    case "Quantity":
      obs.valueQuantity = value as { value: number; unit?: string };
      break;
  }

  return obs;
}
