/**
 * Patient-facing routes.
 *
 * SUC-01: GET  /patient/questionnaires/:id
 * SUC-02: POST /patient/questionnaires/:id/responses
 * SUC-03: GET  /patient/responses/:responseId
 *
 * Traceability: issues #18, #19, #20.
 */

import { randomUUID } from "node:crypto";
import { Elysia, t } from "elysia";
import type { Answer, ValidationError } from "mediform-core";
import { compileResponse, parseMediform } from "mediform-core";
import {
	fetchFhirResponse,
	HapiFhirError,
	submitFhirBundle,
} from "../fhir-client.js";
import { toPatientQuestionnaire } from "../patient-view.js";
import { getRecord } from "../store.js";

export const patientRoutes = new Elysia({ prefix: "/patient" })

	// -------------------------------------------------------------------------
	// SUC-01: Get published questionnaire for patient fill-in
	// -------------------------------------------------------------------------
	.get(
		"/questionnaires/:id",
		({ params, set }) => {
			const { id } = params;
			const record = getRecord(id);

			if (!record) {
				set.status = 404;
				return { message: "Questionnaire not found" };
			}

			// BR-032: retired → 410 Gone
			if (record.status === "retired") {
				set.status = 410;
				return { message: "Questionnaire retired" };
			}

			// BR-004: only published questionnaires are visible to patients
			if (record.status !== "published") {
				set.status = 404;
				return { message: "Questionnaire not found" };
			}

			const parseResult = parseMediform(record.source);
			if (!parseResult.questionnaire) {
				set.status = 500;
				return { message: "Internal server error" };
			}

			return toPatientQuestionnaire(record.id, parseResult.questionnaire);
		},
		{
			params: t.Object({ id: t.String() }),
			detail: {
				summary: "Get a published questionnaire for patient fill-in (SUC-01)",
			},
		},
	)

	// -------------------------------------------------------------------------
	// SUC-02: POST /patient/questionnaires/:id/responses  (#19)
	// -------------------------------------------------------------------------
	.post(
		"/questionnaires/:id/responses",
		async ({ params: { id }, body, set }) => {
			const record = getRecord(id);
			if (!record) {
				set.status = 404;
				return { message: "Questionnaire not found" };
			}

			// BR-032: retired questionnaires reject new responses
			if (record.status === "retired") {
				set.status = 410;
				return { message: "Questionnaire retired" };
			}

			// BR-004: only published questionnaires accept responses
			if (record.status !== "published") {
				set.status = 404;
				return { message: "Questionnaire not found" };
			}

			const parseResult = parseMediform(record.source);
			if (!parseResult.questionnaire) {
				set.status = 500;
				return { message: "Internal server error" };
			}

			const parsed = parseResult.questionnaire;
			const answers = body.answers as Answer[];

			// BR-001: validate required questions are answered
			const validationErrors: ValidationError[] = [];
			const answeredIds = new Set(answers.map((a) => a.questionId));

			for (const section of parsed.sections) {
				for (const q of section.questions) {
					if (q.required && !answeredIds.has(q.id)) {
						validationErrors.push({
							questionId: q.id,
							code: "REQUIRED",
							message: `Question "${q.title}" is required but was not answered.`,
						});
					}
				}
			}

			if (validationErrors.length > 0) {
				set.status = 422;
				return { errors: validationErrors };
			}

			// Compile answers to FHIR resources
			const fhirQuestionnaireRef = record.fhirQuestionnaireId
				? `Questionnaire/${record.fhirQuestionnaireId}`
				: undefined;

			const compiled = compileResponse({
				questionnaire: parsed,
				answers,
				...(fhirQuestionnaireRef ? { fhirQuestionnaireRef } : {}),
			});

			// BR-005: submit atomically; 502 on HAPI failure, persist nothing
			let bundleResult: {
				questionnaireResponseId: string;
				observationIds: string[];
			};
			try {
				bundleResult = await submitFhirBundle(
					compiled.questionnaireResponse,
					compiled.observations,
				);
			} catch (err) {
				if (err instanceof HapiFhirError) {
					set.status = 502;
					return { message: "HAPI error" };
				}
				throw err;
			}

			const responseId = randomUUID();
			const responseLink = `/r/${responseId}`;

			set.status = 201;
			return {
				responseId,
				responseLink,
				fhirQuestionnaireResponseId: bundleResult.questionnaireResponseId,
				observationIds: bundleResult.observationIds,
			};
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({ answers: t.Array(t.Any()) }),
			detail: {
				summary: "Submit patient answers for a questionnaire (SUC-02)",
			},
		},
	)

	// -------------------------------------------------------------------------
	// SUC-03: GET /patient/responses/:responseId  (#20)
	// -------------------------------------------------------------------------
	.get(
		"/responses/:responseId",
		async ({ params: { responseId }, set }) => {
			let result: {
				questionnaireResponse: import("mediform-core").FHIRQuestionnaireResponse;
				observations: import("mediform-core").FHIRObservation[];
			};
			try {
				result = await fetchFhirResponse(responseId);
			} catch (err) {
				if (err instanceof HapiFhirError) {
					set.status = err.statusCode === 404 ? 404 : 502;
					return {
						message:
							err.statusCode === 404 ? "Response not found" : "HAPI error",
					};
				}
				throw err;
			}

			const { questionnaireResponse } = result;

			// Map FHIR items → CompletedAnswer (BR-006: optional unanswered = null)
			const answers = (questionnaireResponse.item ?? []).map((item) => ({
				questionId: item.linkId,
				questionTitle: "",
				answer: item.answer?.[0]?.value ?? null,
			}));

			return {
				responseId,
				responseLink: `/r/${responseId}`,
				questionnaireId: "",
				submittedAt: questionnaireResponse.authored,
				answers,
			};
		},
		{
			params: t.Object({ responseId: t.String() }),
			detail: { summary: "Retrieve a completed response (SUC-03)" },
		},
	);
