/**
 * Unit tests for fhir-client.ts — London school (mock fetch).
 *
 * Traceability: issues #47, #48, #46, #49.
 */

import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type {
	FHIRObservation,
	FHIRQuestionnaire,
	FHIRQuestionnaireResponse,
} from "mediform-core";
import {
	createFhirQuestionnaire,
	fetchFhirResponse,
	HapiFhirError,
	submitFhirBundle,
	updateFhirQuestionnaireStatus,
} from "../fhir-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MINIMAL_QUESTIONNAIRE: FHIRQuestionnaire = {
	resourceType: "Questionnaire",
	title: "Test",
	version: "1.0",
	status: "draft",
};

function makeFetchMock(
	responses: Array<{ ok: boolean; status: number; body: unknown }>,
): ReturnType<typeof spyOn> {
	let call = 0;
	return spyOn(globalThis, "fetch").mockImplementation(async () => {
		const r = responses[call++];
		return {
			ok: r.ok,
			status: r.status,
			json: async () => r.body,
		} as Response;
	});
}

afterEach(() => {
	mock.restore();
});

// ---------------------------------------------------------------------------
// createFhirQuestionnaire
// ---------------------------------------------------------------------------

describe("createFhirQuestionnaire", () => {
	it("returns the FHIR id on 201 response", async () => {
		makeFetchMock([{ ok: true, status: 201, body: { id: "abc-123" } }]);

		const id = await createFhirQuestionnaire(MINIMAL_QUESTIONNAIRE);

		expect(id).toBe("abc-123");
	});

	it("throws HapiFhirError on non-2xx response", async () => {
		makeFetchMock([{ ok: false, status: 500, body: {} }]);

		await expect(
			createFhirQuestionnaire(MINIMAL_QUESTIONNAIRE),
		).rejects.toBeInstanceOf(HapiFhirError);
	});

	it("HapiFhirError carries the status code", async () => {
		makeFetchMock([{ ok: false, status: 422, body: {} }]);

		let caught: HapiFhirError | undefined;
		try {
			await createFhirQuestionnaire(MINIMAL_QUESTIONNAIRE);
		} catch (err) {
			caught = err as HapiFhirError;
		}

		expect(caught?.statusCode).toBe(422);
	});
});

// ---------------------------------------------------------------------------
// updateFhirQuestionnaireStatus
// ---------------------------------------------------------------------------

describe("updateFhirQuestionnaireStatus", () => {
	it("calls PUT with status 'retired' after GET", async () => {
		const fetchSpy = makeFetchMock([
			{ ok: true, status: 200, body: { ...MINIMAL_QUESTIONNAIRE, id: "q1" } },
			{ ok: true, status: 200, body: {} },
		]);

		await updateFhirQuestionnaireStatus("q1", "retired");

		// Two fetch calls: GET then PUT
		expect(fetchSpy).toHaveBeenCalledTimes(2);

		const [putUrl, putInit] = fetchSpy.mock.calls[1] as [string, RequestInit];
		expect(putUrl).toContain("/Questionnaire/q1");
		expect(putInit.method).toBe("PUT");

		const putBody = JSON.parse(putInit.body as string) as FHIRQuestionnaire;
		expect(putBody.status).toBe("retired");
	});

	it("throws HapiFhirError when GET returns non-2xx", async () => {
		makeFetchMock([{ ok: false, status: 404, body: {} }]);

		await expect(
			updateFhirQuestionnaireStatus("missing", "retired"),
		).rejects.toBeInstanceOf(HapiFhirError);
	});

	it("throws HapiFhirError when PUT returns non-2xx", async () => {
		makeFetchMock([
			{ ok: true, status: 200, body: { ...MINIMAL_QUESTIONNAIRE, id: "q1" } },
			{ ok: false, status: 500, body: {} },
		]);

		await expect(
			updateFhirQuestionnaireStatus("q1", "retired"),
		).rejects.toBeInstanceOf(HapiFhirError);
	});
});

// ---------------------------------------------------------------------------
// submitFhirBundle (#46)
// ---------------------------------------------------------------------------

const MINIMAL_QR: FHIRQuestionnaireResponse = {
	resourceType: "QuestionnaireResponse",
	status: "completed",
	authored: "2026-06-03T00:00:00Z",
	item: [],
};

const MINIMAL_OBS: FHIRObservation = {
	resourceType: "Observation",
	status: "final",
	code: { coding: [] },
};

describe("submitFhirBundle", () => {
	it("returns resource IDs extracted from bundle entry locations", async () => {
		makeFetchMock([
			{
				ok: true,
				status: 200,
				body: {
					resourceType: "Bundle",
					type: "transaction-response",
					entry: [
						{
							response: { location: "QuestionnaireResponse/qr-123/_history/1" },
						},
						{ response: { location: "Observation/obs-456/_history/1" } },
					],
				},
			},
		]);

		const result = await submitFhirBundle(MINIMAL_QR, [MINIMAL_OBS]);

		expect(result.questionnaireResponseId).toBe("qr-123");
		expect(result.observationIds).toEqual(["obs-456"]);
	});

	it("throws HapiFhirError on non-2xx response", async () => {
		makeFetchMock([{ ok: false, status: 500, body: {} }]);

		await expect(submitFhirBundle(MINIMAL_QR, [])).rejects.toBeInstanceOf(
			HapiFhirError,
		);
	});

	it("handles empty observations list", async () => {
		makeFetchMock([
			{
				ok: true,
				status: 200,
				body: {
					entry: [
						{
							response: { location: "QuestionnaireResponse/qr-001/_history/1" },
						},
					],
				},
			},
		]);

		const result = await submitFhirBundle(MINIMAL_QR, []);
		expect(result.questionnaireResponseId).toBe("qr-001");
		expect(result.observationIds).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// fetchFhirResponse (#49)
// ---------------------------------------------------------------------------

describe("fetchFhirResponse", () => {
	it("returns QR and observations on success", async () => {
		makeFetchMock([
			{ ok: true, status: 200, body: MINIMAL_QR },
			{
				ok: true,
				status: 200,
				body: {
					resourceType: "Bundle",
					entry: [{ resource: MINIMAL_OBS }],
				},
			},
		]);

		const result = await fetchFhirResponse("qr-123");

		expect(result.questionnaireResponse.resourceType).toBe(
			"QuestionnaireResponse",
		);
		expect(result.observations).toHaveLength(1);
	});

	it("throws HapiFhirError(404) when QR not found", async () => {
		makeFetchMock([{ ok: false, status: 404, body: {} }]);

		let caught: HapiFhirError | undefined;
		try {
			await fetchFhirResponse("missing");
		} catch (err) {
			caught = err as HapiFhirError;
		}

		expect(caught).toBeInstanceOf(HapiFhirError);
		expect(caught?.statusCode).toBe(404);
	});

	it("throws HapiFhirError on observation search failure", async () => {
		makeFetchMock([
			{ ok: true, status: 200, body: MINIMAL_QR },
			{ ok: false, status: 500, body: {} },
		]);

		await expect(fetchFhirResponse("qr-123")).rejects.toBeInstanceOf(
			HapiFhirError,
		);
	});
});
