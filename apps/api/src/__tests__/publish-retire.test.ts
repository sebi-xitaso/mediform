/**
 * Integration tests for publish and retire routes.
 *
 * Style: London school — HAPI FHIR calls are mocked via module mock.
 * Real Elysia routes and in-memory store are used.
 *
 * Traceability: issues #37 (SUC-12), #38 (SUC-13).
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
import type { QuestionnaireRecord } from "mediform-core";
import * as fhirClient from "../fhir-client.js";
import { staffRoutes } from "../routes/staff.js";
import { _clearStore, createRecord, updateStatus } from "../store.js";

// ---------------------------------------------------------------------------
// Test app
// ---------------------------------------------------------------------------

const app = new Elysia().use(staffRoutes);

async function req(method: string, path: string): Promise<Response> {
	return app.handle(new Request(`http://localhost${path}`, { method }));
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const VALID_SOURCE = `\
---
title: Pain Assessment
description: Post-op pain check
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

const INVALID_SOURCE = `# No Frontmatter\n\n- type: string\n`;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeApprovedRecord(): QuestionnaireRecord {
	const r = createRecord({ title: "Test", source: VALID_SOURCE });
	return updateStatus(r.id, "approved") as QuestionnaireRecord;
}

function makePublishedRecord(): QuestionnaireRecord {
	const r = makeApprovedRecord();
	return updateStatus(r.id, "published", {
		patientLink: `/q/${r.id}`,
		fhirQuestionnaireId: "fhir-001",
	}) as QuestionnaireRecord;
}

// ---------------------------------------------------------------------------
// SUC-12: POST /staff/questionnaires/:id/publish
// ---------------------------------------------------------------------------

describe("POST /staff/questionnaires/:id/publish", () => {
	let createSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		_clearStore();
		mock.restore();
		createSpy = spyOn(fhirClient, "createFhirQuestionnaire").mockResolvedValue(
			"fhir-999",
		);
	});

	afterEach(() => {
		mock.restore();
	});

	it("returns 200 with patientLink and fhirQuestionnaireId on success", async () => {
		const record = makeApprovedRecord();
		const res = await req("POST", `/staff/questionnaires/${record.id}/publish`);

		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			questionnaire: QuestionnaireRecord;
			patientLink: string;
			fhirQuestionnaireId: string;
		};
		expect(body.patientLink).toBe(`/q/${record.id}`);
		expect(body.fhirQuestionnaireId).toBe("fhir-999");
		expect(body.questionnaire.status).toBe("published");
		expect(createSpy).toHaveBeenCalledTimes(1);
	});

	it("returns 404 if questionnaire does not exist", async () => {
		const res = await req(
			"POST",
			"/staff/questionnaires/does-not-exist/publish",
		);
		expect(res.status).toBe(404);
	});

	it("returns 409 if questionnaire is not in Approved status", async () => {
		const record = createRecord({ title: "Test", source: VALID_SOURCE });
		// record is draft, not approved
		const res = await req("POST", `/staff/questionnaires/${record.id}/publish`);
		expect(res.status).toBe(409);
	});

	it("returns 422 if source fails to compile", async () => {
		const r = createRecord({ title: "Bad", source: INVALID_SOURCE });
		updateStatus(r.id, "approved");
		const res = await req("POST", `/staff/questionnaires/${r.id}/publish`);
		expect(res.status).toBe(422);
	});

	it("returns 502 if HAPI throws HapiFhirError", async () => {
		createSpy.mockRejectedValue(new fhirClient.HapiFhirError("HAPI down", 503));
		const record = makeApprovedRecord();
		const res = await req("POST", `/staff/questionnaires/${record.id}/publish`);
		expect(res.status).toBe(502);
	});
});

// ---------------------------------------------------------------------------
// SUC-13: POST /staff/questionnaires/:id/retire
// ---------------------------------------------------------------------------

describe("POST /staff/questionnaires/:id/retire", () => {
	let updateStatusSpy: ReturnType<typeof spyOn>;

	beforeEach(() => {
		_clearStore();
		mock.restore();
		updateStatusSpy = spyOn(
			fhirClient,
			"updateFhirQuestionnaireStatus",
		).mockResolvedValue(undefined);
	});

	afterEach(() => {
		mock.restore();
	});

	it("returns 200 with retired questionnaire on success", async () => {
		const record = makePublishedRecord();
		const res = await req("POST", `/staff/questionnaires/${record.id}/retire`);

		expect(res.status).toBe(200);
		const body = (await res.json()) as { questionnaire: QuestionnaireRecord };
		expect(body.questionnaire.status).toBe("retired");
		expect(updateStatusSpy).toHaveBeenCalledWith("fhir-001", "retired");
	});

	it("returns 404 if questionnaire does not exist", async () => {
		const res = await req(
			"POST",
			"/staff/questionnaires/does-not-exist/retire",
		);
		expect(res.status).toBe(404);
	});

	it("returns 409 if questionnaire is not in Published status", async () => {
		const record = makeApprovedRecord();
		const res = await req("POST", `/staff/questionnaires/${record.id}/retire`);
		expect(res.status).toBe(409);
	});

	it("returns 502 if HAPI throws HapiFhirError", async () => {
		updateStatusSpy.mockRejectedValue(
			new fhirClient.HapiFhirError("HAPI down", 503),
		);
		const record = makePublishedRecord();
		const res = await req("POST", `/staff/questionnaires/${record.id}/retire`);
		expect(res.status).toBe(502);
	});

	it("retires locally without HAPI call when fhirQuestionnaireId is absent", async () => {
		// Create a published record without a fhirQuestionnaireId
		const r = makeApprovedRecord();
		// Directly set to published without fhirQuestionnaireId
		spyOn(fhirClient, "createFhirQuestionnaire").mockResolvedValue("");
		updateStatus(r.id, "published", { patientLink: `/q/${r.id}` });

		const res = await req("POST", `/staff/questionnaires/${r.id}/retire`);
		expect(res.status).toBe(200);
		expect(updateStatusSpy).not.toHaveBeenCalled();
	});
});
