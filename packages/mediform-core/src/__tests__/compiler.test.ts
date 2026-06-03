/**
 * TDD tests for the .mediform → FHIR Questionnaire compiler (SUC-10 compile phase).
 *
 * Style: Chicago school — tests drive the compiler via real parsed input and
 * assert on the returned FHIR structure. No mocks needed for a pure function.
 *
 * Traceability: issue #15, SUC-10 compile phase, NFR-15.
 */

import { describe, expect, it } from "bun:test";
import { compileFhirQuestionnaire } from "../compiler.js";
import type { ParsedQuestionnaire } from "../types.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const SIMPLE_QUESTIONNAIRE: ParsedQuestionnaire = {
	frontmatter: {
		title: "Pain Assessment",
		description: "Post-op pain check",
		version: "1.0",
		status: "draft",
	},
	sections: [
		{
			title: null,
			questions: [
				{
					id: "pain-location",
					title: "Pain Location",
					description: "Where do you feel pain?",
					type: "choice",
					mapsTo: "Coding",
					required: true,
					loinc: "72514-3",
					options: [
						{ label: "Head", snomedCode: "SNOMED:25064002" },
						{ label: "Chest", snomedCode: "SNOMED:51185008" },
					],
					config: {},
				},
			],
		},
	],
};

const WITH_SECTION: ParsedQuestionnaire = {
	frontmatter: {
		title: "Full Assessment",
		version: "1.0",
		status: "published",
	},
	sections: [
		{
			title: "General",
			questions: [
				{
					id: "q1",
					title: "Overall Pain",
					type: "string",
					mapsTo: "string",
					required: false,
					config: {},
				},
			],
		},
	],
};

// ---------------------------------------------------------------------------
// Metadata mapping
// ---------------------------------------------------------------------------

describe("compileFhirQuestionnaire – metadata", () => {
	it("maps title, description, and version", () => {
		const result = compileFhirQuestionnaire(SIMPLE_QUESTIONNAIRE);
		expect(result.success).toBe(true);
		expect(result.fhirQuestionnaire?.title).toBe("Pain Assessment");
		expect(result.fhirQuestionnaire?.description).toBe("Post-op pain check");
		expect(result.fhirQuestionnaire?.version).toBe("1.0");
	});

	it("maps draft status to FHIR draft", () => {
		const result = compileFhirQuestionnaire(SIMPLE_QUESTIONNAIRE);
		expect(result.fhirQuestionnaire?.status).toBe("draft");
	});

	it("maps published status to FHIR active", () => {
		const result = compileFhirQuestionnaire(WITH_SECTION);
		expect(result.fhirQuestionnaire?.status).toBe("active");
	});

	it("maps retired status to FHIR retired", () => {
		const q: ParsedQuestionnaire = {
			frontmatter: { title: "T", version: "1", status: "retired" },
			sections: [],
		};
		const result = compileFhirQuestionnaire(q);
		expect(result.fhirQuestionnaire?.status).toBe("retired");
	});

	it("maps other statuses (review, approved, rejected) to FHIR draft", () => {
		for (const s of ["review", "approved", "rejected"] as const) {
			const q: ParsedQuestionnaire = {
				frontmatter: { title: "T", version: "1", status: s },
				sections: [],
			};
			const result = compileFhirQuestionnaire(q);
			expect(result.fhirQuestionnaire?.status).toBe("draft");
		}
	});
});

// ---------------------------------------------------------------------------
// Section items
// ---------------------------------------------------------------------------

describe("compileFhirQuestionnaire – sections", () => {
	it("wraps a named section as a group item", () => {
		const result = compileFhirQuestionnaire(WITH_SECTION);
		expect(result.success).toBe(true);
		const items = result.fhirQuestionnaire!.item!;
		expect(items[0].type).toBe("group");
		expect(items[0].text).toBe("General");
		expect(items[0].linkId).toBeTruthy();
	});

	it("inlines top-level questions when section title is null", () => {
		const result = compileFhirQuestionnaire(SIMPLE_QUESTIONNAIRE);
		const items = result.fhirQuestionnaire!.item!;
		// Inline: questions appear directly without a group wrapper
		expect(items[0].type).not.toBe("group");
	});
});

// ---------------------------------------------------------------------------
// Question items
// ---------------------------------------------------------------------------

describe("compileFhirQuestionnaire – questions", () => {
	it("maps a choice question to FHIR choice type", () => {
		const result = compileFhirQuestionnaire(SIMPLE_QUESTIONNAIRE);
		const item = result.fhirQuestionnaire!.item![0];
		expect(item.type).toBe("choice");
		expect(item.text).toBe("Pain Location");
		expect(item.required).toBe(true);
	});

	it("maps LOINC code to item.code array", () => {
		const result = compileFhirQuestionnaire(SIMPLE_QUESTIONNAIRE);
		const item = result.fhirQuestionnaire!.item![0];
		expect(item.code).toHaveLength(1);
		expect(item.code?.[0].code).toBe("72514-3");
		expect(item.code?.[0].system).toBe("http://loinc.org");
	});

	it("maps SNOMED options to answerOption.valueCoding", () => {
		const result = compileFhirQuestionnaire(SIMPLE_QUESTIONNAIRE);
		const item = result.fhirQuestionnaire!.item![0];
		expect(item.answerOption).toHaveLength(2);
		expect(item.answerOption?.[0].valueCoding?.code).toBe("25064002");
		expect(item.answerOption?.[0].valueCoding?.system).toBe(
			"http://snomed.info/sct",
		);
		expect(item.answerOption?.[0].valueCoding?.display).toBe("Head");
	});

	it("maps string question to FHIR string type", () => {
		const result = compileFhirQuestionnaire(WITH_SECTION);
		const groupItem = result.fhirQuestionnaire!.item![0];
		const qItem = groupItem.item![0];
		expect(qItem.type).toBe("string");
	});

	it("maps boolean question to FHIR boolean type", () => {
		const q: ParsedQuestionnaire = {
			frontmatter: { title: "T", version: "1", status: "draft" },
			sections: [
				{
					title: null,
					questions: [
						{
							id: "q",
							title: "Yes or no",
							type: "boolean",
							mapsTo: "boolean",
							required: false,
							config: {},
						},
					],
				},
			],
		};
		const result = compileFhirQuestionnaire(q);
		expect(result.fhirQuestionnaire!.item?.[0]?.type).toBe("boolean");
	});

	it("maps custom question to FHIR attachment type", () => {
		const q: ParsedQuestionnaire = {
			frontmatter: { title: "T", version: "1", status: "draft" },
			sections: [
				{
					title: null,
					questions: [
						{
							id: "custom-q",
							title: "Draw something",
							type: "custom",
							mapsTo: "decimal",
							required: false,
							config: {},
							renderer: "export default function() {}",
						},
					],
				},
			],
		};
		const result = compileFhirQuestionnaire(q);
		expect(result.fhirQuestionnaire!.item?.[0]?.type).toBe("attachment");
	});

	it("generates a stable linkId for each item", () => {
		const result = compileFhirQuestionnaire(SIMPLE_QUESTIONNAIRE);
		const item = result.fhirQuestionnaire!.item![0];
		expect(item.linkId).toBeTruthy();
		expect(typeof item.linkId).toBe("string");
	});
});

// ---------------------------------------------------------------------------
// Validation errors
// ---------------------------------------------------------------------------

describe("compileFhirQuestionnaire – errors", () => {
	it("returns an error for a malformed LOINC code", () => {
		const q: ParsedQuestionnaire = {
			frontmatter: { title: "T", version: "1", status: "draft" },
			sections: [
				{
					title: null,
					questions: [
						{
							id: "q",
							title: "Q",
							type: "string",
							mapsTo: "string",
							required: false,
							loinc: "not-a-loinc",
							config: {},
						},
					],
				},
			],
		};
		const result = compileFhirQuestionnaire(q);
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.message.match(/loinc/i))).toBe(true);
	});

	it("returns an error for a malformed SNOMED code in options", () => {
		const q: ParsedQuestionnaire = {
			frontmatter: { title: "T", version: "1", status: "draft" },
			sections: [
				{
					title: null,
					questions: [
						{
							id: "q",
							title: "Q",
							type: "choice",
							mapsTo: "Coding",
							required: false,
							options: [{ label: "Bad", snomedCode: "NOTSNOMED" }],
							config: {},
						},
					],
				},
			],
		};
		const result = compileFhirQuestionnaire(q);
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.message.match(/snomed/i))).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// NFR-15: performance
// ---------------------------------------------------------------------------

describe("compileFhirQuestionnaire – NFR-15 performance", () => {
	it("compiles a 200-question questionnaire within 100ms", () => {
		const questions = Array.from({ length: 200 }, (_, i) => ({
			id: `q${i}`,
			title: `Question ${i}`,
			type: "string" as const,
			mapsTo: "string" as const,
			required: false,
			config: {},
		}));

		const q: ParsedQuestionnaire = {
			frontmatter: { title: "Big Form", version: "1", status: "draft" },
			sections: [{ title: null, questions }],
		};

		const start = performance.now();
		compileFhirQuestionnaire(q);
		const elapsed = performance.now() - start;

		expect(elapsed).toBeLessThan(100);
	});
});
