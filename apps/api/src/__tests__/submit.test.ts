/**
 * Integration tests for:
 *   - POST /staff/questionnaires/:id/submit  (SUC-07, #28)
 *   - GET  /staff/questionnaires/:id/quality-check (SUC-14 partial, #53)
 *
 * Style: Chicago school — exercises real routes via Elysia .handle().
 * Traceability: issues #28, #53, BR-016, BR-017, BR-018, BR-019.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import type { QuestionnaireRecord } from "mediform-core";
import type { QualityCheckResponse } from "mediform-core";
import { staffRoutes } from "../routes/staff.js";
import { _clearStore, createRecord, updateStatus } from "../store.js";

const app = new Elysia().use(staffRoutes);

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

beforeEach(() => _clearStore());

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

const VALID_NO_LOINC = VALID_SOURCE.replace(/- loinc: 72514-3\n/, "");

const INVALID_SOURCE = `# No Frontmatter\n\n- type: string\n`;

// ---------------------------------------------------------------------------
// SUC-07: POST /staff/questionnaires/:id/submit
// ---------------------------------------------------------------------------

describe("POST /staff/questionnaires/:id/submit", () => {
	it("transitions Draft → Review on a valid questionnaire (BR-019)", async () => {
		const r = createRecord({ title: "Pain", source: VALID_SOURCE });
		const res = await req("POST", `/staff/questionnaires/${r.id}/submit`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			questionnaire: QuestionnaireRecord;
			qualityCheck: QualityCheckResponse;
		};
		expect(body.questionnaire.status).toBe("review");
	});

	it("returns the quality-check response on success", async () => {
		const r = createRecord({ title: "Pain", source: VALID_SOURCE });
		const res = await req("POST", `/staff/questionnaires/${r.id}/submit`);
		const body = (await res.json()) as {
			questionnaire: QuestionnaireRecord;
			qualityCheck: QualityCheckResponse;
		};
		expect(body.qualityCheck.passed).toBe(true);
		expect(body.qualityCheck.results.map((x) => x.name)).toContain("syntax_valid");
	});

	it("allows submit when LOINC codes are missing (warning only, BR-017)", async () => {
		const r = createRecord({ title: "No LOINC", source: VALID_NO_LOINC });
		const res = await req("POST", `/staff/questionnaires/${r.id}/submit`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as {
			questionnaire: QuestionnaireRecord;
			qualityCheck: QualityCheckResponse;
		};
		expect(body.questionnaire.status).toBe("review");
		// metadata_complete is a warning, not a failure
		const metaCheck = body.qualityCheck.results.find(
			(r) => r.name === "metadata_complete",
		);
		expect(metaCheck?.status).toBe("warning");
	});

	it("returns 422 SYNTAX_ERRORS when source has parse errors (BR-016)", async () => {
		const r = createRecord({ title: "Bad", source: INVALID_SOURCE });
		const res = await req("POST", `/staff/questionnaires/${r.id}/submit`);
		expect(res.status).toBe(422);
		const body = (await res.json()) as {
			reason: string;
			details: unknown[];
		};
		expect(body.reason).toBe("SYNTAX_ERRORS");
		expect(body.details.length).toBeGreaterThan(0);
	});

	it("does not change status when blocked by syntax errors", async () => {
		const r = createRecord({ title: "Bad", source: INVALID_SOURCE });
		await req("POST", `/staff/questionnaires/${r.id}/submit`);
		// Re-fetch by listing
		const listRes = await req("GET", "/staff/questionnaires");
		const list = (await listRes.json()) as { id: string; status: string }[];
		const found = list.find((x) => x.id === r.id);
		expect(found?.status).toBe("draft");
	});

	it("returns 409 when questionnaire is not in Draft status (BR-019)", async () => {
		const r = createRecord({ title: "T", source: VALID_SOURCE });
		updateStatus(r.id, "review");
		const res = await req("POST", `/staff/questionnaires/${r.id}/submit`);
		expect(res.status).toBe(409);
	});

	it("returns 404 for an unknown questionnaire", async () => {
		const res = await req("POST", "/staff/questionnaires/no-such-id/submit");
		expect(res.status).toBe(404);
	});

	it("persists quality-check results (#53)", async () => {
		const r = createRecord({ title: "Pain", source: VALID_SOURCE });
		await req("POST", `/staff/questionnaires/${r.id}/submit`);
		const qcRes = await req("GET", `/staff/questionnaires/${r.id}/quality-check`);
		expect(qcRes.status).toBe(200);
		const qc = (await qcRes.json()) as QualityCheckResponse;
		expect(qc.checkedAt).toBeTruthy();
		expect(Array.isArray(qc.results)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// SUC-14 partial: GET /staff/questionnaires/:id/quality-check
// ---------------------------------------------------------------------------

describe("GET /staff/questionnaires/:id/quality-check", () => {
	it("returns 404 when no checks have been run", async () => {
		const r = createRecord({ title: "T", source: VALID_SOURCE });
		const res = await req("GET", `/staff/questionnaires/${r.id}/quality-check`);
		expect(res.status).toBe(404);
	});

	it("returns the latest check result after a submit", async () => {
		const r = createRecord({ title: "Pain", source: VALID_SOURCE });
		await req("POST", `/staff/questionnaires/${r.id}/submit`);
		const res = await req("GET", `/staff/questionnaires/${r.id}/quality-check`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as QualityCheckResponse;
		expect(body.passed).toBe(true);
	});

	it("returns 404 for an unknown questionnaire", async () => {
		const res = await req("GET", "/staff/questionnaires/no-such-id/quality-check");
		expect(res.status).toBe(404);
	});
});
