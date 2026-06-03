/**
 * Unit tests for the quality-check engine and built-in checks.
 *
 * Style: Chicago school — pure functions, no mocks.
 * Traceability: issue #50, SUC-14, BR-016, BR-017, BR-018.
 */

import { describe, expect, it } from "bun:test";
import type { ParsedQuestionnaire, ParseError } from "mediform-core";
import {
	DEFAULT_CHECKS,
	metadataCompleteCheck,
	runQualityChecks,
	syntaxValidCheck,
	type QualityCheck,
	type QualityCheckInput,
} from "../quality-check.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const noErrors: ParseError[] = [];

function makeQuestion(id: string, title: string, loinc?: string) {
	return {
		id,
		title,
		type: "string" as const,
		required: false,
		...(loinc ? { loinc } : {}),
	};
}

function makeParsed(questions: ReturnType<typeof makeQuestion>[]): ParsedQuestionnaire {
	return {
		frontmatter: {
			title: "Test",
			version: "1.0",
			status: "draft",
		},
		sections: [{ title: null, questions }],
	};
}

// ---------------------------------------------------------------------------
// syntaxValidCheck
// ---------------------------------------------------------------------------

describe("syntaxValidCheck", () => {
	it("passes when there are no parse errors", () => {
		const result = syntaxValidCheck.run({ parseErrors: noErrors });
		expect(result.status).toBe("passed");
	});

	it("fails when there are parse errors", () => {
		const errors: ParseError[] = [{ line: 1, message: "Bad syntax" }];
		const result = syntaxValidCheck.run({ parseErrors: errors });
		expect(result.status).toBe("failed");
		expect(result.errors).toHaveLength(1);
		expect(result.details).toMatch(/1 syntax error/);
	});

	it("includes all errors in result", () => {
		const errors: ParseError[] = [
			{ line: 1, message: "Err 1" },
			{ line: 5, message: "Err 2" },
		];
		const result = syntaxValidCheck.run({ parseErrors: errors });
		expect(result.errors).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// metadataCompleteCheck
// ---------------------------------------------------------------------------

describe("metadataCompleteCheck", () => {
	it("passes when all questions have LOINC codes", () => {
		const input: QualityCheckInput = {
			parsed: makeParsed([makeQuestion("q1", "Q One", "72514-3")]),
			parseErrors: noErrors,
		};
		const result = metadataCompleteCheck.run(input);
		expect(result.status).toBe("passed");
	});

	it("warns when a question is missing a LOINC code", () => {
		const input: QualityCheckInput = {
			parsed: makeParsed([makeQuestion("q1", "Q One")]),
			parseErrors: noErrors,
		};
		const result = metadataCompleteCheck.run(input);
		expect(result.status).toBe("warning");
		expect(result.warnings).toHaveLength(1);
		expect(result.warnings?.[0].field).toBe("loinc");
	});

	it("passes (skipped) when there is no parsed questionnaire", () => {
		const input: QualityCheckInput = { parseErrors: noErrors };
		const result = metadataCompleteCheck.run(input);
		expect(result.status).toBe("passed");
	});

	it("warns for every question missing LOINC", () => {
		const input: QualityCheckInput = {
			parsed: makeParsed([makeQuestion("q1", "Q1"), makeQuestion("q2", "Q2")]),
			parseErrors: noErrors,
		};
		const result = metadataCompleteCheck.run(input);
		expect(result.warnings).toHaveLength(2);
	});
});

// ---------------------------------------------------------------------------
// runQualityChecks engine
// ---------------------------------------------------------------------------

describe("runQualityChecks", () => {
	it("returns passed=true when all checks pass", () => {
		const input: QualityCheckInput = {
			parsed: makeParsed([makeQuestion("q1", "Q", "12345-6")]),
			parseErrors: noErrors,
		};
		const response = runQualityChecks(input);
		expect(response.passed).toBe(true);
	});

	it("returns passed=false when any check fails", () => {
		const input: QualityCheckInput = {
			parseErrors: [{ line: 1, message: "Syntax error" }],
		};
		const response = runQualityChecks(input);
		expect(response.passed).toBe(false);
	});

	it("treats warning-only results as passed", () => {
		// syntax_valid passes, metadata_complete warns
		const input: QualityCheckInput = {
			parsed: makeParsed([makeQuestion("q1", "Q without LOINC")]),
			parseErrors: noErrors,
		};
		const response = runQualityChecks(input);
		expect(response.passed).toBe(true);
	});

	it("runs checks in order and returns all results", () => {
		const input: QualityCheckInput = {
			parsed: makeParsed([makeQuestion("q1", "Q", "12345-6")]),
			parseErrors: noErrors,
		};
		const response = runQualityChecks(input, DEFAULT_CHECKS);
		expect(response.results.map((r) => r.name)).toEqual([
			"syntax_valid",
			"metadata_complete",
		]);
	});

	it("supports pluggable custom checks", () => {
		const alwaysFail: QualityCheck = {
			name: "custom_fail",
			run: () => ({ name: "custom_fail", status: "failed", details: "Always fails" }),
		};
		const response = runQualityChecks(
			{ parseErrors: noErrors },
			[alwaysFail],
		);
		expect(response.passed).toBe(false);
		expect(response.results[0].name).toBe("custom_fail");
	});

	it("sets checkedAt to an ISO timestamp", () => {
		const response = runQualityChecks({ parseErrors: noErrors });
		expect(() => new Date(response.checkedAt)).not.toThrow();
	});
});
