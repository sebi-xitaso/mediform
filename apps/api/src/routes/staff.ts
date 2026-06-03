/**
 * Staff questionnaire routes.
 *
 * SUC-04: POST /staff/questionnaires/import
 * SUC-05: POST /staff/questionnaires/preview
 * SUC-06: PUT  /staff/questionnaires/:id
 *
 * Traceability: issues #25, #26, #27.
 */

import { Elysia, t } from "elysia";
import { parseMediform, compileFhirQuestionnaire } from "mediform-core";
import type { MetadataWarning, ParsedQuestionnaire } from "mediform-core";
import { createRecord, getRecord, updateSource } from "../store.js";
import { toPatientQuestionnaire } from "../patient-view.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produce metadata warnings for optional but recommended fields.
 * BR-010: missing optional metadata → warning, not rejection.
 */
function collectMetadataWarnings(
  parsed: ParsedQuestionnaire
): MetadataWarning[] {
  const warnings: MetadataWarning[] = [];

  for (const section of parsed.sections) {
    for (const q of section.questions) {
      if (!q.loinc) {
        warnings.push({
          questionId: q.id,
          field: "loinc",
          message: `Question "${q.title}" has no LOINC code. FHIR coding will be incomplete.`,
        });
      }
      if (!q.mapsTo) {
        warnings.push({
          questionId: q.id,
          field: "maps-to",
          message: `Question "${q.title}" has no maps-to mapping.`,
        });
      }
    }
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const staffRoutes = new Elysia({ prefix: "/staff" })

  // -------------------------------------------------------------------------
  // SUC-04: Import questionnaire
  // -------------------------------------------------------------------------
  .post(
    "/questionnaires/import",
    ({ body, set }) => {
      const { source } = body;

      if (!source || source.trim() === "") {
        set.status = 400;
        return { message: "Missing or empty source" };
      }

      const parseResult = parseMediform(source);

      if (!parseResult.success || !parseResult.questionnaire) {
        set.status = 422;
        return {
          message: "Syntax errors in .mediform source",
          errors: parseResult.errors,
        };
      }

      const { questionnaire } = parseResult;
      const warnings = collectMetadataWarnings(questionnaire);

      const record = createRecord({
        title: questionnaire.frontmatter.title,
        description: questionnaire.frontmatter.description,
        source,
      });

      set.status = 201;
      return { questionnaire: record, warnings };
    },
    {
      body: t.Object({ source: t.String() }),
      detail: { summary: "Import a .mediform questionnaire (SUC-04)" },
    }
  )

  // -------------------------------------------------------------------------
  // SUC-05: Preview questionnaire (no persistence)
  // -------------------------------------------------------------------------
  .post(
    "/questionnaires/preview",
    ({ body, set }) => {
      const { source } = body;

      if (!source || source.trim() === "") {
        set.status = 400;
        return { message: "Missing or empty source" };
      }

      const parseResult = parseMediform(source);

      if (!parseResult.questionnaire) {
        // Entirely unparseable
        return {
          questionnaire: null,
          errors: parseResult.errors,
        };
      }

      // Best-effort: return the patient view even if there were partial errors
      const patientView = toPatientQuestionnaire(
        "preview",
        parseResult.questionnaire
      );

      return {
        questionnaire: patientView,
        errors: parseResult.errors,
      };
    },
    {
      body: t.Object({ source: t.String() }),
      detail: { summary: "Preview a .mediform questionnaire without saving (SUC-05)" },
    }
  )

  // -------------------------------------------------------------------------
  // SUC-06: Update questionnaire source
  // -------------------------------------------------------------------------
  .put(
    "/questionnaires/:id",
    ({ params, body, set }) => {
      const { source } = body;
      const { id } = params;

      if (!source || source.trim() === "") {
        set.status = 400;
        return { message: "Missing or empty source" };
      }

      const record = getRecord(id);

      if (!record) {
        set.status = 404;
        return { message: "Questionnaire not found" };
      }

      if (record.status !== "draft") {
        set.status = 409;
        return { message: "Questionnaire is not in Draft status" };
      }

      // Parse for validation — saving is allowed even with syntax errors (BR-014)
      const parseResult = parseMediform(source);

      // Extract updated title/description from successful parse
      const updatedTitle = parseResult.questionnaire?.frontmatter.title;
      const updatedDescription =
        parseResult.questionnaire?.frontmatter.description;

      const updated = updateSource(id, {
        source,
        title: updatedTitle,
        description: updatedDescription,
      });

      const validation = {
        valid: parseResult.success,
        errors: parseResult.errors,
        warnings: parseResult.warnings,
      };

      return { questionnaire: updated, validation };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ source: t.String() }),
      detail: { summary: "Update a draft questionnaire's source (SUC-06)" },
    }
  );
