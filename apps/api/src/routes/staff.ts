/**
 * Staff questionnaire routes.
 *
 * SUC-04: POST /staff/questionnaires/import
 * SUC-05: POST /staff/questionnaires/preview
 * SUC-06: PUT  /staff/questionnaires/:id
 * SUC-07: POST /staff/questionnaires/:id/submit
 * SUC-08: GET  /staff/questionnaires
 * SUC-09: POST /staff/questionnaires/:id/review
 * SUC-12: POST /staff/questionnaires/:id/publish
 * SUC-13: POST /staff/questionnaires/:id/retire
 *
 * Traceability: issues #25, #26, #27, #28, #29, #36, #37, #38.
 */

import { Elysia, t } from "elysia";
import type {
	MetadataWarning,
	ParsedQuestionnaire,
	QuestionnaireListItem,
	QuestionnaireRecord,
	QuestionnaireStatus,
	ReviewDecision,
} from "mediform-core";
import {
	compileFhirQuestionnaire,
	parseMediform,
	runQualityChecks,
} from "mediform-core";
import {
	createFhirQuestionnaire,
	HapiFhirError,
	updateFhirQuestionnaireStatus,
} from "../fhir-client.js";
import { toPatientQuestionnaire } from "../patient-view.js";
import {
	createRecord,
	getQualityCheck,
	getRecord,
	listRecords,
	saveQualityCheck,
	updateSource,
	updateStatus,
} from "../store.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Produce metadata warnings for optional but recommended fields.
 * BR-010: missing optional metadata → warning, not rejection.
 */
function collectMetadataWarnings(
	parsed: ParsedQuestionnaire,
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
				...(questionnaire.frontmatter.description !== undefined
					? { description: questionnaire.frontmatter.description }
					: {}),
				source,
			});

			set.status = 201;
			return { questionnaire: record, warnings };
		},
		{
			body: t.Object({ source: t.String() }),
			detail: { summary: "Import a .mediform questionnaire (SUC-04)" },
		},
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
				parseResult.questionnaire,
			);

			return {
				questionnaire: patientView,
				errors: parseResult.errors,
			};
		},
		{
			body: t.Object({ source: t.String() }),
			detail: {
				summary: "Preview a .mediform questionnaire without saving (SUC-05)",
			},
		},
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
				...(updatedTitle !== undefined ? { title: updatedTitle } : {}),
				...(updatedDescription !== undefined
					? { description: updatedDescription }
					: {}),
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
		},
	)

	// -------------------------------------------------------------------------
	// SUC-08: List questionnaires with optional status filter
	// -------------------------------------------------------------------------
	.get(
		"/questionnaires",
		({ query, set }) => {
			const VALID_STATUSES = new Set<string>([
				"draft",
				"review",
				"approved",
				"published",
				"retired",
				"rejected",
			]);

			// `status` may be a single string or an array (repeated query param)
			const rawStatus = query.status;
			const requestedStatuses: string[] = rawStatus
				? Array.isArray(rawStatus)
					? rawStatus
					: [rawStatus]
				: [];

			for (const s of requestedStatuses) {
				if (!VALID_STATUSES.has(s)) {
					set.status = 400;
					return { message: "Invalid status filter", invalidValue: s };
				}
			}

			const records = listRecords(
				requestedStatuses.length > 0
					? (requestedStatuses as QuestionnaireStatus[])
					: undefined,
			);

			const items: QuestionnaireListItem[] = records.map((r) => ({
				id: r.id,
				title: r.title,
				status: r.status,
				author: r.author,
				lastModified: r.lastModified,
				hasReviewFeedback: !!r.reviewFeedback,
			}));

			return items;
		},
		{
			query: t.Object({
				status: t.Optional(t.Union([t.String(), t.Array(t.String())])),
			}),
			detail: {
				summary: "List questionnaires with optional status filter (SUC-08)",
			},
		},
	)

	// -------------------------------------------------------------------------
	// SUC-09: Record a review decision (approve / request_changes / reject)
	// -------------------------------------------------------------------------
	.post(
		"/questionnaires/:id/review",
		({ params, body, set }) => {
			const { id } = params;
			const { decision, feedback } = body;

			const VALID_DECISIONS: ReviewDecision[] = [
				"approve",
				"request_changes",
				"reject",
			];
			if (!VALID_DECISIONS.includes(decision as ReviewDecision)) {
				set.status = 400;
				return { message: "Invalid decision value" };
			}

			const record = getRecord(id);

			if (!record) {
				set.status = 404;
				return { message: "Questionnaire not found" };
			}

			if (record.status !== "review") {
				set.status = 409;
				return { message: "Questionnaire is not in Review status" };
			}

			// BR-023: feedback required for request_changes and reject
			if (
				(decision === "request_changes" || decision === "reject") &&
				(!feedback || feedback.trim() === "")
			) {
				set.status = 422;
				return { message: "Feedback required for this decision" };
			}

			let updated: QuestionnaireRecord | undefined;
			if (decision === "approve") {
				updated = updateStatus(id, "approved");
			} else if (decision === "request_changes") {
				// BR-025: attach feedback, transition back to Draft
				updated = updateStatus(id, "draft", {
					...(feedback !== undefined ? { reviewFeedback: feedback } : {}),
				});
			} else {
				// reject
				updated = updateStatus(id, "rejected", {
					...(feedback !== undefined ? { rejectionReason: feedback } : {}),
				});
			}

			return { questionnaire: updated };
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({
				decision: t.String(),
				feedback: t.Optional(t.String()),
			}),
			detail: { summary: "Record a review decision (SUC-09)" },
		},
	)

	// -------------------------------------------------------------------------
	// SUC-07: POST /staff/questionnaires/:id/submit  (#28)
	// -------------------------------------------------------------------------
	// Transitions Draft → Review when all quality checks pass.
	// BR-016: block on syntax errors  (reason: SYNTAX_ERRORS)
	// BR-017: warn but do not block on missing metadata (metadata_complete is
	//         advisory — a "warning" check result is still allowed through)
	// BR-018: all four quality checks run on submit
	// BR-019: only Draft questionnaires may be submitted
	.post(
		"/questionnaires/:id/submit",
		({ params: { id }, set }) => {
			const record = getRecord(id);
			if (!record) {
				set.status = 404;
				return { message: "Questionnaire not found" };
			}

			if (record.status !== "draft") {
				set.status = 409;
				return {
					message: `Only Draft questionnaires may be submitted for review. Current status: ${record.status}`,
				};
			}

			// Parse & run quality checks
			const parseResult = parseMediform(record.source);
			const checkResponse = runQualityChecks({
				parsed: parseResult.questionnaire,
				parseErrors: parseResult.errors,
			});

			// Persist quality-check results (BR-036, #53)
			saveQualityCheck(id, checkResponse);

			// BR-016: syntax errors are a hard block
			const syntaxResult = checkResponse.results.find(
				(r) => r.name === "syntax_valid",
			);
			if (syntaxResult?.status === "failed") {
				set.status = 422;
				return {
					reason: "SYNTAX_ERRORS",
					details: syntaxResult.errors ?? [],
				};
			}

			// All blocking checks passed — transition to Review
			const updated = updateStatus(id, "review");
			return { questionnaire: updated, qualityCheck: checkResponse };
		},
		{
			params: t.Object({ id: t.String() }),
			detail: { summary: "Submit questionnaire for review (SUC-07)" },
		},
	)

	// -------------------------------------------------------------------------
	// SUC-12: POST /staff/questionnaires/:id/publish  (#37)
	// -------------------------------------------------------------------------
	.post(
		"/questionnaires/:id/publish",
		async ({ params, set }) => {
			const { id } = params;

			const record = getRecord(id);
			if (!record) {
				set.status = 404;
				return { message: "Questionnaire not found" };
			}

			if (record.status !== "approved") {
				set.status = 409;
				return { message: "Questionnaire is not in Approved status" };
			}

			const parseResult = parseMediform(record.source);
			if (!parseResult.questionnaire) {
				set.status = 422;
				return {
					message: "Compile failed",
					errors: parseResult.errors,
				};
			}

			const compileResult = compileFhirQuestionnaire(parseResult.questionnaire);
			if (!compileResult.success || !compileResult.fhirQuestionnaire) {
				set.status = 422;
				return {
					message: "Compile failed",
					errors: compileResult.errors,
				};
			}

			let fhirQuestionnaireId: string;
			try {
				fhirQuestionnaireId = await createFhirQuestionnaire(
					compileResult.fhirQuestionnaire,
				);
			} catch (err) {
				if (err instanceof HapiFhirError) {
					set.status = 502;
					return { message: "HAPI error" };
				}
				throw err;
			}

			const patientLink = `/q/${record.id}`;
			const updated = updateStatus(id, "published", {
				patientLink,
				fhirQuestionnaireId,
			});

			return { questionnaire: updated, patientLink, fhirQuestionnaireId };
		},
		{
			params: t.Object({ id: t.String() }),
			detail: { summary: "Publish an approved questionnaire (SUC-12)" },
		},
	)

	// -------------------------------------------------------------------------
	// SUC-13: POST /staff/questionnaires/:id/retire  (#38)
	// -------------------------------------------------------------------------
	.post(
		"/questionnaires/:id/retire",
		async ({ params, set }) => {
			const { id } = params;

			const record = getRecord(id);
			if (!record) {
				set.status = 404;
				return { message: "Questionnaire not found" };
			}

			if (record.status !== "published") {
				set.status = 409;
				return { message: "Questionnaire is not in Published status" };
			}

			if (record.fhirQuestionnaireId) {
				try {
					await updateFhirQuestionnaireStatus(
						record.fhirQuestionnaireId,
						"retired",
					);
				} catch (err) {
					if (err instanceof HapiFhirError) {
						set.status = 502;
						return { message: "HAPI error" };
					}
					throw err;
				}
			}

			const updated = updateStatus(id, "retired");
			return { questionnaire: updated };
		},
		{
			params: t.Object({ id: t.String() }),
			detail: { summary: "Retire a published questionnaire (SUC-13)" },
		},
	)

	// -------------------------------------------------------------------------
	// SUC-14: GET /staff/questionnaires/:id/quality-check
	// -------------------------------------------------------------------------
	// Returns the latest persisted quality-check result for a questionnaire.
	// (Lightweight endpoint; full SUC-14 implementation lives in a future story.)
	.get(
		"/questionnaires/:id/quality-check",
		({ params: { id }, set }) => {
			const record = getRecord(id);
			if (!record) {
				set.status = 404;
				return { message: "Questionnaire not found" };
			}
			const result = getQualityCheck(id);
			if (!result) {
				set.status = 404;
				return { message: "No quality-check results found" };
			}
			return result;
		},
		{
			params: t.Object({ id: t.String() }),
			detail: { summary: "Get latest quality-check results (SUC-14 partial)" },
		},
	);
