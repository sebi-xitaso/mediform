/**
 * Patient-facing questionnaire routes.
 *
 * SUC-01: GET /patient/questionnaires/:id
 *
 * Traceability: issue #18.
 */

import { Elysia, t } from "elysia";
import { parseMediform } from "mediform-core";
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
	);
