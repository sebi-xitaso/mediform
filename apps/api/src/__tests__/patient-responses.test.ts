/**
 * Integration tests for:
 *   - POST /patient/questionnaires/:id/responses  (SUC-02, #19)
 *   - GET  /patient/responses/:responseId         (SUC-03, #20)
 *
 * Style: London school — fhir-client.ts is mocked via spyOn; routes are
 * exercised via Elysia .handle().
 *
 * Traceability: issues #19, #20, #46, #49, BR-001, BR-004, BR-005, BR-006, BR-032.
 */

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	mock,
	spyOn,
} from "bun:test";
import { Elysia } from "elysia";
import type { CompletedResponse, ValidationError } from "mediform-core";
import * as fhirClient from "../fhir-client.js";
import { patientRoutes } from "../routes/patient.js";
import { _clearStore, createRecord, updateStatus } from "../store.js";

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

const app = new Elysia().use(patientRoutes);

async function req(
	method: string,
	path: string,
	body?: unknown,
): Promise<Response> {
	return app.handle(
		new Request(`http://localhost${path}`, {
			method,
			headers: { "Content-Type": "application/json" },
			body: body !== undefined ? JSON.stringify(body) : undefined,
		}),
	);
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_SOURCE = `\
---
title: Pain Assessment
version: 1.0
status: draft
---

# Pain Location

Where do you feel pain?

- type: choice
- required: true
- maps-to: Coding
- loinc: 72514-3
- options:
  - Head | SNOMED:25064002
  - Chest | SNOMED:51185008
`;

beforeEach(() => {
	_clearStore();
	mock.restore();
});

afterEach(() => {
	mock.restore();
});

// ---------------------------------------------------------------------------
// SUC-02: POST /patient/questionnaires/:id/responses
// ---------------------------------------------------------------------------

describe("POST /patient/questionnaires/:id/responses", () => {
	function makePublished() {
		const r = createRecord({ title: "Pain", source: VALID_SOURCE });
		const updated = updateStatus(r.id, "published", {
			fhirQuestionnaireId: "fhir-q-123",
		});
		if (!updated) throw new Error("updateStatus returned undefined");
		return updated;
	}

	const VALID_ANSWERS = [{ questionId: "pain-location", value: "Head" }];

	it("returns 201 with response IDs on valid published questionnaire", async () => {
		spyOn(fhirClient, "submitFhirBundle").mockResolvedValue({
			questionnaireResponseId: "qr-fhir-001",
			observationIds: ["obs-001"],
		});
		const record = makePublished();
		const res = await req(
			"POST",
			`/patient/questionnaires/${record.id}/responses`,
			{ answers: VALID_ANSWERS },
		);
		expect(res.status).toBe(201);
		const body = (await res.json()) as {
			responseId: string;
			responseLink: string;
			fhirQuestionnaireResponseId: string;
			observationIds: string[];
		};
		expect(body.responseId).toBeTruthy();
		expect(body.responseLink).toMatch(/^\/r\//);
		expect(body.fhirQuestionnaireResponseId).toBe("qr-fhir-001");
		expect(body.observationIds).toContain("obs-001");
	});

	it("calls submitFhirBundle with the compiled resources (BR-005)", async () => {
		const bundleSpy = spyOn(fhirClient, "submitFhirBundle").mockResolvedValue({
			questionnaireResponseId: "qr-001",
			observationIds: [],
		});
		const record = makePublished();
		await req("POST", `/patient/questionnaires/${record.id}/responses`, {
			answers: VALID_ANSWERS,
		});
		expect(bundleSpy).toHaveBeenCalledTimes(1);
	});

	it("returns 422 with REQUIRED error when required question not answered (BR-001)", async () => {
		const record = makePublished();
		const res = await req(
			"POST",
			`/patient/questionnaires/${record.id}/responses`,
			{ answers: [] },
		);
		expect(res.status).toBe(422);
		const body = (await res.json()) as { errors: ValidationError[] };
		expect(body.errors[0].code).toBe("REQUIRED");
	});

	it("returns 502 and persists nothing when HAPI bundle fails (BR-005)", async () => {
		spyOn(fhirClient, "submitFhirBundle").mockRejectedValue(
			new fhirClient.HapiFhirError("HAPI down", 503),
		);
		const record = makePublished();
		const res = await req(
			"POST",
			`/patient/questionnaires/${record.id}/responses`,
			{ answers: VALID_ANSWERS },
		);
		expect(res.status).toBe(502);
	});

	it("returns 404 for a non-existent questionnaire", async () => {
		const res = await req(
			"POST",
			"/patient/questionnaires/no-such-id/responses",
			{
				answers: [],
			},
		);
		expect(res.status).toBe(404);
	});

	it("returns 404 for a non-published questionnaire (BR-004)", async () => {
		const r = createRecord({ title: "Draft", source: VALID_SOURCE });
		const res = await req("POST", `/patient/questionnaires/${r.id}/responses`, {
			answers: VALID_ANSWERS,
		});
		expect(res.status).toBe(404);
	});

	it("returns 410 for a retired questionnaire (BR-032)", async () => {
		const r = createRecord({ title: "Retired", source: VALID_SOURCE });
		updateStatus(r.id, "retired");
		const res = await req("POST", `/patient/questionnaires/${r.id}/responses`, {
			answers: VALID_ANSWERS,
		});
		expect(res.status).toBe(410);
	});
});

// ---------------------------------------------------------------------------
// SUC-03: GET /patient/responses/:responseId
// ---------------------------------------------------------------------------

describe("GET /patient/responses/:responseId", () => {
	it("returns 200 with CompletedResponse on success", async () => {
		spyOn(fhirClient, "fetchFhirResponse").mockResolvedValue({
			questionnaireResponse: {
				resourceType: "QuestionnaireResponse",
				status: "completed",
				authored: "2026-06-03T12:00:00Z",
				item: [{ linkId: "q1", answer: [{ value: "Head" }] }],
			},
			observations: [],
		});
		const res = await req("GET", "/patient/responses/qr-001");
		expect(res.status).toBe(200);
		const body = (await res.json()) as CompletedResponse;
		expect(body.responseId).toBe("qr-001");
		expect(body.responseLink).toBe("/r/qr-001");
		expect(Array.isArray(body.answers)).toBe(true);
		expect(body.submittedAt).toBeTruthy();
	});

	it("maps FHIR items to answers (BR-006: unanswered = null)", async () => {
		spyOn(fhirClient, "fetchFhirResponse").mockResolvedValue({
			questionnaireResponse: {
				resourceType: "QuestionnaireResponse",
				status: "completed",
				authored: "2026-06-03T12:00:00Z",
				item: [
					{ linkId: "q1", answer: [{ value: "Head" }] },
					{ linkId: "q2" }, // no answer — should be null (BR-006)
				],
			},
			observations: [],
		});
		const res = await req("GET", "/patient/responses/qr-002");
		const body = (await res.json()) as CompletedResponse;
		expect(body.answers[0].answer).toBe("Head");
		expect(body.answers[1].answer).toBeNull();
	});

	it("returns 404 when HAPI returns 404", async () => {
		spyOn(fhirClient, "fetchFhirResponse").mockRejectedValue(
			new fhirClient.HapiFhirError("Not found", 404),
		);
		const res = await req("GET", "/patient/responses/missing");
		expect(res.status).toBe(404);
	});

	it("returns 502 on other HAPI errors", async () => {
		spyOn(fhirClient, "fetchFhirResponse").mockRejectedValue(
			new fhirClient.HapiFhirError("Server error", 503),
		);
		const res = await req("GET", "/patient/responses/qr-503");
		expect(res.status).toBe(502);
	});
});
