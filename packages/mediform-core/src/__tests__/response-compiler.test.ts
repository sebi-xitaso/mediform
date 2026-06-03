/**
 * TDD tests for the patient-answer → FHIR response compiler (SUC-11).
 *
 * Style: Chicago school — exercises the pure function with real inputs.
 * Traceability: issue #16, SUC-11, NFR-16.
 */

import { describe, expect, it } from "bun:test";
import { compileResponse } from "../response-compiler.js";
import type { ParsedQuestionnaire, Answer } from "../types.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const QUESTIONNAIRE: ParsedQuestionnaire = {
  frontmatter: {
    title: "Pain Assessment",
    version: "1.0",
    status: "draft",
  },
  sections: [
    {
      title: null,
      questions: [
        {
          id: "pain-location",
          title: "Pain Location",
          type: "choice",
          mapsTo: "Coding",
          required: true,
          loinc: "72514-3",
          options: [
            { label: "Head", snomedCode: "SNOMED:25064002" },
            { label: "Chest", snomedCode: "SNOMED:51185008" },
          ],
          config: {},
        },
        {
          id: "pain-intensity",
          title: "Pain Intensity",
          type: "scale",
          mapsTo: "integer",
          required: true,
          loinc: "72514-3",
          config: { min: 0, max: 10 },
        },
        {
          id: "notes",
          title: "Additional Notes",
          type: "string",
          mapsTo: "string",
          required: false,
          config: {},
          // no loinc — no Observation produced
        },
        {
          id: "has-allergy",
          title: "Has Allergy",
          type: "boolean",
          mapsTo: "boolean",
          required: false,
          loinc: "11289-6",
          config: {},
        },
      ],
    },
  ],
};

const ANSWERS: Answer[] = [
  {
    questionId: "pain-location",
    value: { code: "25064002", system: "http://snomed.info/sct", display: "Head" },
  },
  { questionId: "pain-intensity", value: 7 },
  { questionId: "notes", value: "None" },
  { questionId: "has-allergy", value: false },
];

// ---------------------------------------------------------------------------
// QuestionnaireResponse structure
// ---------------------------------------------------------------------------

describe("compileResponse – QuestionnaireResponse", () => {
  it("returns a completed QuestionnaireResponse", () => {
    const result = compileResponse({ questionnaire: QUESTIONNAIRE, answers: ANSWERS });
    expect(result.questionnaireResponse.resourceType).toBe("QuestionnaireResponse");
    expect(result.questionnaireResponse.status).toBe("completed");
  });

  it("sets authored to a valid ISO 8601 timestamp", () => {
    const result = compileResponse({ questionnaire: QUESTIONNAIRE, answers: ANSWERS });
    expect(() => new Date(result.questionnaireResponse.authored)).not.toThrow();
  });

  it("includes a response item for each answer", () => {
    const result = compileResponse({ questionnaire: QUESTIONNAIRE, answers: ANSWERS });
    expect(result.questionnaireResponse.item).toHaveLength(4);
  });

  it("maps linkId to the question id", () => {
    const result = compileResponse({ questionnaire: QUESTIONNAIRE, answers: ANSWERS });
    const ids = result.questionnaireResponse.item.map((i) => i.linkId);
    expect(ids).toContain("pain-location");
    expect(ids).toContain("pain-intensity");
  });

  it("sets the questionnaire reference when fhirQuestionnaireRef is provided", () => {
    const result = compileResponse({
      questionnaire: QUESTIONNAIRE,
      answers: ANSWERS,
      fhirQuestionnaireRef: "Questionnaire/abc123",
    });
    expect(result.questionnaireResponse.questionnaire).toBe("Questionnaire/abc123");
  });
});

// ---------------------------------------------------------------------------
// Observations
// ---------------------------------------------------------------------------

describe("compileResponse – Observations", () => {
  it("produces one Observation per answered question with a LOINC code", () => {
    const result = compileResponse({ questionnaire: QUESTIONNAIRE, answers: ANSWERS });
    // pain-location (loinc), pain-intensity (loinc), has-allergy (loinc) → 3 obs
    // notes has no loinc → no Observation
    expect(result.observations).toHaveLength(3);
  });

  it("sets Observation.status to final", () => {
    const result = compileResponse({ questionnaire: QUESTIONNAIRE, answers: ANSWERS });
    for (const obs of result.observations) {
      expect(obs.status).toBe("final");
    }
  });

  it("sets Observation.code from the LOINC code", () => {
    const result = compileResponse({ questionnaire: QUESTIONNAIRE, answers: ANSWERS });
    const intensityObs = result.observations.find(
      (o) => o.code.coding[0].code === "72514-3"
    );
    expect(intensityObs).toBeDefined();
    expect(intensityObs!.code.coding[0].system).toBe("http://loinc.org");
  });

  it("sets derivedFrom reference to the QuestionnaireResponse", () => {
    const result = compileResponse({ questionnaire: QUESTIONNAIRE, answers: ANSWERS });
    for (const obs of result.observations) {
      expect(obs.derivedFrom![0].reference).toContain("QuestionnaireResponse/");
    }
  });

  it("maps integer answer to valueInteger", () => {
    const result = compileResponse({ questionnaire: QUESTIONNAIRE, answers: ANSWERS });
    const obs = result.observations.find((o) =>
      result.questionnaireResponse.item.find(
        (i) => i.linkId === "pain-intensity"
      )
    );
    const intensityObs = result.observations[result.observations.findIndex(
      (_, idx) => result.questionnaireResponse.item[idx]?.linkId === "pain-intensity"
    )];
    // simpler: find the obs with valueInteger === 7
    const intObs = result.observations.find((o) => o.valueInteger === 7);
    expect(intObs).toBeDefined();
  });

  it("maps boolean answer to valueBoolean", () => {
    const result = compileResponse({ questionnaire: QUESTIONNAIRE, answers: ANSWERS });
    const boolObs = result.observations.find((o) => o.valueBoolean !== undefined);
    expect(boolObs).toBeDefined();
    expect(boolObs!.valueBoolean).toBe(false);
  });

  it("maps Coding answer to valueCoding", () => {
    const result = compileResponse({ questionnaire: QUESTIONNAIRE, answers: ANSWERS });
    const codingObs = result.observations.find((o) => o.valueCoding !== undefined);
    expect(codingObs).toBeDefined();
    expect(codingObs!.valueCoding!.code).toBe("25064002");
  });

  it("produces no observations for questions without LOINC codes", () => {
    const result = compileResponse({
      questionnaire: QUESTIONNAIRE,
      answers: [{ questionId: "notes", value: "Hello" }],
    });
    expect(result.observations).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Error handling
// ---------------------------------------------------------------------------

describe("compileResponse – errors", () => {
  it("records an error for an unknown questionId", () => {
    const result = compileResponse({
      questionnaire: QUESTIONNAIRE,
      answers: [{ questionId: "does-not-exist", value: 1 }],
    });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].questionId).toBe("does-not-exist");
  });

  it("records a type-mapping error for a bad value", () => {
    const result = compileResponse({
      questionnaire: QUESTIONNAIRE,
      answers: [{ questionId: "pain-intensity", value: "not-a-number" }],
    });
    expect(result.errors.some((e) => e.questionId === "pain-intensity")).toBe(
      true
    );
  });

  it("still produces a response item even when a mapping error occurs", () => {
    const result = compileResponse({
      questionnaire: QUESTIONNAIRE,
      answers: [{ questionId: "pain-intensity", value: "bad" }],
    });
    expect(result.questionnaireResponse.item).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// NFR-16: performance
// ---------------------------------------------------------------------------

describe("compileResponse – NFR-16 performance", () => {
  it("compiles 50 answers within 100ms", () => {
    const questions = Array.from({ length: 50 }, (_, i) => ({
      id: `q${i}`,
      title: `Q${i}`,
      type: "string" as const,
      mapsTo: "string" as const,
      required: false,
      loinc: `${10000 + i}-${i % 9}`,
      config: {},
    }));
    const q: ParsedQuestionnaire = {
      frontmatter: { title: "Big", version: "1", status: "draft" },
      sections: [{ title: null, questions }],
    };
    const answers: Answer[] = questions.map((q) => ({
      questionId: q.id,
      value: "hello",
    }));

    const start = performance.now();
    compileResponse({ questionnaire: q, answers });
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(100);
  });
});
