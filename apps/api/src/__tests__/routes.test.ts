/**
 * Integration tests for:
 *   - GET /patient/questionnaires/:id  (SUC-01, #18)
 *   - GET /staff/questionnaires        (SUC-08, #29)
 *   - POST /staff/questionnaires/:id/review (SUC-09, #36)
 *
 * Style: Chicago school — exercises real routes via Elysia .handle().
 * Traceability: issues #18, #29, #36.
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { Elysia } from "elysia";
import type {
	PatientQuestionnaire,
	QuestionnaireListItem,
	QuestionnaireRecord,
} from "mediform-core";
import { patientRoutes } from "../routes/patient.js";
import { staffRoutes } from "../routes/staff.js";
import { _clearStore, createRecord, updateStatus } from "../store.js";

// ---------------------------------------------------------------------------
// Test application
// ---------------------------------------------------------------------------

const app = new Elysia().use(staffRoutes).use(patientRoutes);

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

// ---------------------------------------------------------------------------
// SUC-01: GET /patient/questionnaires/:id
// ---------------------------------------------------------------------------

describe("GET /patient/questionnaires/:id", () => {
	beforeEach(() => _clearStore());

	function makePublished(): QuestionnaireRecord {
		const r = createRecord({ title: "Pain Assessment", source: VALID_SOURCE });
		const result = updateStatus(r.id, "published");
		if (!result) throw new Error("updateStatus returned undefined");
		return result;
	}

	it("returns 200 with PatientQuestionnaire for a published questionnaire", async () => {
		const record = makePublished();
		const res = await req("GET", `/patient/questionnaires/${record.id}`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as PatientQuestionnaire;
		expect(body.id).toBe(record.id);
		expect(body.title).toBe("Pain Assessment");
		expect(body.sections).toBeDefined();
	});

	it("strips FHIR-internal fields from the response", async () => {
		const record = makePublished();
		const res = await req("GET", `/patient/questionnaires/${record.id}`);
		const body = (await res.json()) as PatientQuestionnaire;
		const q = body.sections[0].questions[0];
		expect(q.loinc).toBeUndefined();
		expect(q.mapsTo).toBeUndefined();
		expect(q.type).toBe("choice");
	});

	it("includes renderer source for custom-type questions", async () => {
		const customSource = `\
---
title: Custom Q
version: 1.0
status: draft
---

# Draw Something

Trace the pattern.

- type: custom
- required: false
- maps-to: decimal
- renderer: \`\`\`js
  export default function({ onValue }) { onValue(42); }
  \`\`\`
`;
		const r = createRecord({ title: "Custom Q", source: customSource });
		updateStatus(r.id, "published");
		const res = await req("GET", `/patient/questionnaires/${r.id}`);
		const body = (await res.json()) as PatientQuestionnaire;
		const q = body.sections[0].questions[0];
		expect(q.renderer).toContain("onValue");
	});

	it("returns 404 for a non-existent questionnaire", async () => {
		const res = await req("GET", "/patient/questionnaires/does-not-exist");
		expect(res.status).toBe(404);
	});

	it("returns 404 for a questionnaire not in Published status", async () => {
		const r = createRecord({ title: "T", source: VALID_SOURCE });
		// still Draft
		const res = await req("GET", `/patient/questionnaires/${r.id}`);
		expect(res.status).toBe(404);
	});

	it("returns 410 Gone for a retired questionnaire (BR-032)", async () => {
		const r = createRecord({ title: "T", source: VALID_SOURCE });
		updateStatus(r.id, "retired");
		const res = await req("GET", `/patient/questionnaires/${r.id}`);
		expect(res.status).toBe(410);
	});
});

// ---------------------------------------------------------------------------
// SUC-08: GET /staff/questionnaires
// ---------------------------------------------------------------------------

describe("GET /staff/questionnaires", () => {
	beforeEach(() => _clearStore());

	it("returns 200 with an empty array when no questionnaires exist", async () => {
		const res = await req("GET", "/staff/questionnaires");
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual([]);
	});

	it("returns all questionnaires when no filter is provided", async () => {
		createRecord({ title: "A", source: VALID_SOURCE });
		createRecord({ title: "B", source: VALID_SOURCE });
		const res = await req("GET", "/staff/questionnaires");
		const body = (await res.json()) as QuestionnaireListItem[];
		expect(body).toHaveLength(2);
	});

	it("returns QuestionnaireListItem shape", async () => {
		const r = createRecord({ title: "A", source: VALID_SOURCE });
		const res = await req("GET", "/staff/questionnaires");
		const body = (await res.json()) as QuestionnaireListItem[];
		const item = body[0];
		expect(item.id).toBe(r.id);
		expect(item.title).toBe("A");
		expect(item.status).toBe("draft");
		expect(item.author).toBe("staff");
		expect(item.lastModified).toBeTruthy();
		expect(typeof item.hasReviewFeedback).toBe("boolean");
	});

	it("filters by a single status", async () => {
		const r = createRecord({ title: "A", source: VALID_SOURCE });
		createRecord({ title: "B", source: VALID_SOURCE });
		updateStatus(r.id, "review");
		const res = await req("GET", "/staff/questionnaires?status=review");
		const body = (await res.json()) as QuestionnaireListItem[];
		expect(body).toHaveLength(1);
		expect(body[0].status).toBe("review");
	});

	it("filters by multiple statuses via repeated query param", async () => {
		const a = createRecord({ title: "A", source: VALID_SOURCE });
		const b = createRecord({ title: "B", source: VALID_SOURCE });
		createRecord({ title: "C", source: VALID_SOURCE }); // stays draft
		updateStatus(a.id, "review");
		updateStatus(b.id, "approved");
		const res = await req(
			"GET",
			"/staff/questionnaires?status=review&status=approved",
		);
		const body = (await res.json()) as QuestionnaireListItem[];
		expect(body).toHaveLength(2);
	});

	it("prioritizes Review items at the top of the list (BR-035)", async () => {
		createRecord({ title: "Draft", source: VALID_SOURCE });
		const r = createRecord({ title: "In Review", source: VALID_SOURCE });
		updateStatus(r.id, "review");
		const res = await req("GET", "/staff/questionnaires");
		const body = (await res.json()) as QuestionnaireListItem[];
		expect(body[0].status).toBe("review");
	});

	it("sorts within same status by lastModified descending", async () => {
		const a = createRecord({ title: "Old", source: VALID_SOURCE });
		await new Promise((r) => setTimeout(r, 5));
		const b = createRecord({ title: "New", source: VALID_SOURCE });
		const res = await req("GET", "/staff/questionnaires");
		const body = (await res.json()) as QuestionnaireListItem[];
		expect(body[0].id).toBe(b.id);
		expect(body[1].id).toBe(a.id);
	});

	it("sets hasReviewFeedback true when questionnaire has feedback", async () => {
		const r = createRecord({ title: "R", source: VALID_SOURCE });
		updateStatus(r.id, "review");
		updateStatus(r.id, "draft", { reviewFeedback: "Please fix this." });
		const res = await req("GET", "/staff/questionnaires");
		const body = (await res.json()) as QuestionnaireListItem[];
		expect(body[0].hasReviewFeedback).toBe(true);
	});

	it("returns 400 for an invalid status filter value", async () => {
		const res = await req("GET", "/staff/questionnaires?status=invalid");
		expect(res.status).toBe(400);
	});
});

// ---------------------------------------------------------------------------
// SUC-09: POST /staff/questionnaires/:id/review
// ---------------------------------------------------------------------------

describe("POST /staff/questionnaires/:id/review", () => {
	beforeEach(() => _clearStore());

	function makeReview(): QuestionnaireRecord {
		const r = createRecord({ title: "T", source: VALID_SOURCE });
		const result = updateStatus(r.id, "review");
		if (!result) throw new Error("updateStatus returned undefined");
		return result;
	}

	it("transitions to Approved on approve decision", async () => {
		const record = makeReview();
		const res = await req("POST", `/staff/questionnaires/${record.id}/review`, {
			decision: "approve",
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { questionnaire: QuestionnaireRecord };
		expect(body.questionnaire.status).toBe("approved");
	});

	it("approve does not require feedback (BR-024)", async () => {
		const record = makeReview();
		const res = await req("POST", `/staff/questionnaires/${record.id}/review`, {
			decision: "approve",
		});
		expect(res.status).toBe(200);
	});

	it("transitions to Draft with feedback on request_changes (BR-025)", async () => {
		const record = makeReview();
		const res = await req("POST", `/staff/questionnaires/${record.id}/review`, {
			decision: "request_changes",
			feedback: "Please add LOINC codes.",
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { questionnaire: QuestionnaireRecord };
		expect(body.questionnaire.status).toBe("draft");
		expect(body.questionnaire.reviewFeedback).toBe("Please add LOINC codes.");
	});

	it("transitions to Rejected with reason on reject", async () => {
		const record = makeReview();
		const res = await req("POST", `/staff/questionnaires/${record.id}/review`, {
			decision: "reject",
			feedback: "Out of scope for this clinic.",
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { questionnaire: QuestionnaireRecord };
		expect(body.questionnaire.status).toBe("rejected");
		expect(body.questionnaire.rejectionReason).toBe(
			"Out of scope for this clinic.",
		);
	});

	it("returns 422 when request_changes feedback is missing (BR-023)", async () => {
		const record = makeReview();
		const res = await req("POST", `/staff/questionnaires/${record.id}/review`, {
			decision: "request_changes",
		});
		expect(res.status).toBe(422);
	});

	it("returns 422 when reject feedback is missing (BR-023)", async () => {
		const record = makeReview();
		const res = await req("POST", `/staff/questionnaires/${record.id}/review`, {
			decision: "reject",
			feedback: "   ",
		});
		expect(res.status).toBe(422);
	});

	it("returns 404 when questionnaire does not exist", async () => {
		const res = await req("POST", "/staff/questionnaires/no-such-id/review", {
			decision: "approve",
		});
		expect(res.status).toBe(404);
	});

	it("returns 409 when questionnaire is not in Review status (BR-021)", async () => {
		const r = createRecord({ title: "T", source: VALID_SOURCE });
		// still Draft
		const res = await req("POST", `/staff/questionnaires/${r.id}/review`, {
			decision: "approve",
		});
		expect(res.status).toBe(409);
	});

	it("returns 400 for an invalid decision value", async () => {
		const record = makeReview();
		const res = await req("POST", `/staff/questionnaires/${record.id}/review`, {
			decision: "publish",
		});
		expect(res.status).toBe(400);
	});
});
