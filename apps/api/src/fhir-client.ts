/**
 * HAPI FHIR client utilities.
 *
 * Provides functions to create and update FHIR Questionnaire resources
 * on a running HAPI FHIR server.
 *
 * Traceability: issues #47, #48, SUC-12, SUC-13.
 */

import type { FHIRQuestionnaire } from "mediform-core";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const HAPI_BASE = Bun.env.HAPI_BASE_URL ?? "http://localhost:8080/fhir";

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class HapiFhirError extends Error {
	readonly statusCode: number;

	constructor(message: string, statusCode: number) {
		super(message);
		this.name = "HapiFhirError";
		this.statusCode = statusCode;
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * POST a FHIR Questionnaire to HAPI with status forced to "active".
 *
 * @returns The FHIR `id` assigned by HAPI.
 * @throws {HapiFhirError} on non-2xx response.
 */
export async function createFhirQuestionnaire(
	compiled: FHIRQuestionnaire,
): Promise<string> {
	const payload: FHIRQuestionnaire = { ...compiled, status: "active" };

	const response = await fetch(`${HAPI_BASE}/Questionnaire`, {
		method: "POST",
		headers: { "Content-Type": "application/fhir+json" },
		body: JSON.stringify(payload),
	});

	if (!response.ok) {
		throw new HapiFhirError(
			`HAPI FHIR returned ${response.status} on POST /Questionnaire`,
			response.status,
		);
	}

	const data = (await response.json()) as { id?: string };

	if (!data.id) {
		throw new HapiFhirError("HAPI FHIR response missing id field", 502);
	}

	return data.id;
}

/**
 * GET a FHIR Questionnaire from HAPI, update its status, and PUT it back.
 *
 * @throws {HapiFhirError} on non-2xx response.
 */
export async function updateFhirQuestionnaireStatus(
	fhirId: string,
	status: "active" | "retired",
): Promise<void> {
	const getResponse = await fetch(`${HAPI_BASE}/Questionnaire/${fhirId}`, {
		headers: { Accept: "application/fhir+json" },
	});

	if (!getResponse.ok) {
		throw new HapiFhirError(
			`HAPI FHIR returned ${getResponse.status} on GET /Questionnaire/${fhirId}`,
			getResponse.status,
		);
	}

	const resource = (await getResponse.json()) as FHIRQuestionnaire;
	const updated: FHIRQuestionnaire = { ...resource, status };

	const putResponse = await fetch(`${HAPI_BASE}/Questionnaire/${fhirId}`, {
		method: "PUT",
		headers: { "Content-Type": "application/fhir+json" },
		body: JSON.stringify(updated),
	});

	if (!putResponse.ok) {
		throw new HapiFhirError(
			`HAPI FHIR returned ${putResponse.status} on PUT /Questionnaire/${fhirId}`,
			putResponse.status,
		);
	}
}
