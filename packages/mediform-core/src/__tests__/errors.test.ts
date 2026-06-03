/**
 * Snapshot tests for structured parse and compile errors (issue #17).
 *
 * Each test verifies that a specific malformed input produces an error with
 * - the correct line number
 * - a clear, jargon-free message referencing the offending field by name
 * - errors separated from warnings (warnings never block success)
 *
 * Style: Chicago school snapshot assertions.
 * Traceability: issue #17, SUC-04, SUC-05, SUC-06.
 */

import { describe, expect, it } from "bun:test";
import { compileFhirQuestionnaire } from "../compiler.js";
import { parseMediform } from "../parser.js";
import type { ParsedQuestionnaire } from "../types.js";

// ---------------------------------------------------------------------------
// Parser error snapshots
// ---------------------------------------------------------------------------

describe("parse errors – snapshots", () => {
	it("malformed frontmatter: missing opening ---", () => {
		const result = parseMediform("title: Test\nversion: 1.0\nstatus: draft\n");
		expect(result.success).toBe(false);
		expect(result.errors).toMatchSnapshot();
	});

	it("malformed frontmatter: missing required title", () => {
		const result = parseMediform(
			"---\nversion: 1.0\nstatus: draft\n---\n\n# Q\n\n- type: string\n",
		);
		expect(result.success).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors[0].line).toBeGreaterThanOrEqual(1);
		expect(result.errors[0].message).toMatch(/title/i);
		expect(result.errors).toMatchSnapshot();
	});

	it("malformed frontmatter: invalid YAML (unclosed bracket)", () => {
		const result = parseMediform("---\ntitle: [unclosed\n---\n");
		expect(result.success).toBe(false);
		expect(result.errors.length).toBeGreaterThan(0);
		expect(result.errors).toMatchSnapshot();
	});

	it("unknown question type", () => {
		const result = parseMediform(
			"---\ntitle: T\nversion: 1.0\nstatus: draft\n---\n\n# Q\n\n- type: wizard\n- maps-to: string\n",
		);
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.message.match(/type/i))).toBe(true);
		expect(result.errors.every((e) => typeof e.line === "number")).toBe(true);
		expect(result.errors).toMatchSnapshot();
	});

	it("missing required type field", () => {
		const result = parseMediform(
			"---\ntitle: T\nversion: 1.0\nstatus: draft\n---\n\n# Q\n\n- maps-to: string\n",
		);
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.message.match(/type/i))).toBe(true);
		expect(result.errors).toMatchSnapshot();
	});

	it("invalid required value (not boolean)", () => {
		const result = parseMediform(
			"---\ntitle: T\nversion: 1.0\nstatus: draft\n---\n\n# Q\n\n- type: string\n- required: maybe\n- maps-to: string\n",
		);
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.message.match(/required/i))).toBe(true);
		expect(result.errors).toMatchSnapshot();
	});
});

// ---------------------------------------------------------------------------
// Warnings do not block success
// ---------------------------------------------------------------------------

describe("parse warnings – never block success", () => {
	it("a question without loinc still parses successfully", () => {
		const result = parseMediform(
			"---\ntitle: T\nversion: 1.0\nstatus: draft\n---\n\n# Q\n\n- type: string\n- maps-to: string\n",
		);
		// parse succeeds even without loinc
		expect(result.success).toBe(true);
		expect(result.errors).toHaveLength(0);
	});
});

// ---------------------------------------------------------------------------
// Compiler error snapshots
// ---------------------------------------------------------------------------

describe("compile errors – snapshots", () => {
	it("malformed LOINC code", () => {
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
		expect(result.errors.every((e) => typeof e.message === "string")).toBe(
			true,
		);
		expect(result.errors).toMatchSnapshot();
	});

	it("malformed SNOMED code in option", () => {
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
							options: [{ label: "Bad", snomedCode: "NOT_SNOMED_123" }],
							config: {},
						},
					],
				},
			],
		};
		const result = compileFhirQuestionnaire(q);
		expect(result.success).toBe(false);
		expect(result.errors.some((e) => e.message.match(/snomed/i))).toBe(true);
		expect(result.errors).toMatchSnapshot();
	});

	it("compile errors carry questionId and field", () => {
		const q: ParsedQuestionnaire = {
			frontmatter: { title: "T", version: "1", status: "draft" },
			sections: [
				{
					title: null,
					questions: [
						{
							id: "my-question",
							title: "My Question",
							type: "string",
							mapsTo: "string",
							required: false,
							loinc: "bad-loinc",
							config: {},
						},
					],
				},
			],
		};
		const result = compileFhirQuestionnaire(q);
		expect(result.errors[0].questionId).toBe("my-question");
		expect(result.errors[0].field).toBe("loinc");
	});
});
