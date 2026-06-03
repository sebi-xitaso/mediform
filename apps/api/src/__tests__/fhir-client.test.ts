/**
 * Unit tests for fhir-client.ts — London school (mock fetch).
 *
 * Traceability: issues #47, #48.
 */

import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import type { FHIRQuestionnaire } from "mediform-core";
import {
	createFhirQuestionnaire,
	HapiFhirError,
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
