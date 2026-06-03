/**
 * HAPI FHIR client utilities.
 *
 * Provides functions to create and update FHIR resources on a running HAPI
 * FHIR server.
 *
 * Traceability: issues #47, #48, #46, #49, SUC-12, SUC-13, SUC-02, SUC-03.
 */

import type {
	FHIRObservation,
	FHIRQuestionnaire,
	FHIRQuestionnaireResponse,
} from "mediform-core";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const HAPI_BASE = Bun.env.HAPI_BASE_URL ?? "http://localhost:8080/fhir";

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

// ---------------------------------------------------------------------------
// #46 — Atomic FHIR transaction bundle (BR-005)
// ---------------------------------------------------------------------------

export interface FhirTransactionResult {
	questionnaireResponseId: string;
	observationIds: string[];
}

/**
 * Submit a QuestionnaireResponse and its derived Observations in a single
 * FHIR transaction bundle (atomicity — BR-005).
 *
 * On 2xx: extracts resource IDs from entry[i].response.location.
 * On non-2xx: throws HapiFhirError — caller must not persist anything.
 */
export async function submitFhirBundle(
	qr: FHIRQuestionnaireResponse,
	observations: FHIRObservation[],
): Promise<FhirTransactionResult> {
	const bundle = {
		resourceType: "Bundle",
		type: "transaction",
		entry: [
			{
				resource: qr,
				request: { method: "POST", url: "QuestionnaireResponse" },
			},
			...observations.map((obs) => ({
				resource: obs,
				request: { method: "POST", url: "Observation" },
			})),
		],
	};

	const response = await fetch(`${HAPI_BASE}/`, {
		method: "POST",
		headers: { "Content-Type": "application/fhir+json" },
		body: JSON.stringify(bundle),
	});

	if (!response.ok) {
		throw new HapiFhirError(
			`HAPI FHIR returned ${response.status} on transaction bundle POST`,
			response.status,
		);
	}

	const result = (await response.json()) as {
		entry?: { response?: { location?: string } }[];
	};

	const entries = result.entry ?? [];

	// Extract resource ID from location header: "ResourceType/id/_history/1"
	function extractId(location: string | undefined): string {
		if (!location) return "";
		const parts = location.split("/");
		// location format: "ResourceType/id/_history/version"
		return parts[1] ?? "";
	}

	const qrId = extractId(entries[0]?.response?.location);
	const obsIds = entries
		.slice(1)
		.map((e) => extractId(e?.response?.location))
		.filter((id) => id !== "");

	return { questionnaireResponseId: qrId, observationIds: obsIds };
}

// ---------------------------------------------------------------------------
// #49 — Fetch QuestionnaireResponse with linked Observations
// ---------------------------------------------------------------------------

export interface FetchResponseResult {
	questionnaireResponse: FHIRQuestionnaireResponse;
	observations: FHIRObservation[];
}

/**
 * Fetch a FHIR QuestionnaireResponse by ID, plus all derived Observations.
 *
 * @throws {HapiFhirError} with statusCode 404 if not found; other codes on
 *   other HAPI failures.
 */
export async function fetchFhirResponse(
	responseId: string,
): Promise<FetchResponseResult> {
	const qrResp = await fetch(
		`${HAPI_BASE}/QuestionnaireResponse/${responseId}`,
		{ headers: { Accept: "application/fhir+json" } },
	);

	if (!qrResp.ok) {
		throw new HapiFhirError(
			`HAPI FHIR returned ${qrResp.status} on GET /QuestionnaireResponse/${responseId}`,
			qrResp.status,
		);
	}

	const questionnaireResponse =
		(await qrResp.json()) as FHIRQuestionnaireResponse;

	const obsResp = await fetch(
		`${HAPI_BASE}/Observation?derived-from=QuestionnaireResponse/${responseId}`,
		{ headers: { Accept: "application/fhir+json" } },
	);

	if (!obsResp.ok) {
		throw new HapiFhirError(
			`HAPI FHIR returned ${obsResp.status} on GET Observations for ${responseId}`,
			obsResp.status,
		);
	}

	const obsBundle = (await obsResp.json()) as {
		entry?: { resource: FHIRObservation }[];
	};

	const observations = (obsBundle.entry ?? []).map((e) => e.resource);

	return { questionnaireResponse, observations };
}
