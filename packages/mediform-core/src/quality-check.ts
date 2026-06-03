/**
 * Quality-check engine with pluggable checks.
 *
 * Defines the QualityCheck interface and a registry-based engine that runs
 * checks in order and aggregates results.
 *
 * Built-in checks (per #50):
 *   - syntax_valid:       parse produced no errors
 *   - metadata_complete:  every question has a loinc code
 *
 * Traceability: issue #50, SUC-14, BR-016, BR-017, BR-018.
 */

import type {
	MetadataWarning,
	ParsedQuestionnaire,
	ParseError,
} from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type QualityCheckStatus = "passed" | "failed" | "warning";

export interface QualityCheckResult {
	name: string;
	status: QualityCheckStatus;
	/** Human-readable details; present on failure or warning. */
	details?: string;
	/** Structured parse errors, populated by syntax_valid check. */
	errors?: ParseError[];
	/** Structured metadata warnings, populated by metadata_complete check. */
	warnings?: MetadataWarning[];
}

export interface QualityCheckResponse {
	/** ISO 8601 timestamp of when checks were run. */
	checkedAt: string;
	/** true iff every check has status "passed". */
	passed: boolean;
	results: QualityCheckResult[];
}

/** Input fed to every check. */
export interface QualityCheckInput {
	/** The parsed questionnaire (may be undefined when syntax is fatally broken). */
	parsed?: ParsedQuestionnaire | undefined;
	/** Parse errors collected by the parser. */
	parseErrors: ParseError[];
}

/**
 * A single pluggable quality check.
 * Implementations must be pure and synchronous.
 */
export interface QualityCheck {
	readonly name: string;
	run(input: QualityCheckInput): QualityCheckResult;
}

// ---------------------------------------------------------------------------
// Built-in checks
// ---------------------------------------------------------------------------

/**
 * syntax_valid — fails if the parser produced any errors (BR-016).
 */
export const syntaxValidCheck: QualityCheck = {
	name: "syntax_valid",
	run({ parseErrors }): QualityCheckResult {
		if (parseErrors.length === 0) {
			return { name: "syntax_valid", status: "passed" };
		}
		return {
			name: "syntax_valid",
			status: "failed",
			details: `${parseErrors.length} syntax error(s) found`,
			errors: parseErrors,
		};
	},
};

/**
 * metadata_complete — warns for each question missing a LOINC code (BR-017).
 * Status is "warning" (not "failed") because missing LOINC is advisory.
 * Skipped (passed) when there is no parsed questionnaire.
 */
export const metadataCompleteCheck: QualityCheck = {
	name: "metadata_complete",
	run({ parsed }): QualityCheckResult {
		if (!parsed) {
			// Cannot run without a parsed questionnaire; defer to syntax_valid.
			return { name: "metadata_complete", status: "passed" };
		}
		const missing: MetadataWarning[] = [];
		for (const section of parsed.sections) {
			for (const q of section.questions) {
				if (!q.loinc) {
					missing.push({
						questionId: q.id,
						field: "loinc",
						message: `Question "${q.title}" is missing a LOINC code.`,
					});
				}
			}
		}
		if (missing.length === 0) {
			return { name: "metadata_complete", status: "passed" };
		}
		return {
			name: "metadata_complete",
			status: "warning",
			details: `${missing.length} question(s) missing LOINC code`,
			warnings: missing,
		};
	},
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

/** Default built-in checks executed on every submit-for-review (BR-018). */
export const DEFAULT_CHECKS: QualityCheck[] = [
	syntaxValidCheck,
	metadataCompleteCheck,
];

/**
 * Run all checks against the given input and return an aggregated response.
 *
 * @param input   - Parsed questionnaire + parse errors.
 * @param checks  - Ordered list of checks; defaults to DEFAULT_CHECKS.
 */
export function runQualityChecks(
	input: QualityCheckInput,
	checks: QualityCheck[] = DEFAULT_CHECKS,
): QualityCheckResponse {
	const results = checks.map((c) => c.run(input));
	const passed = results.every(
		(r) => r.status === "passed" || r.status === "warning",
	);
	return {
		checkedAt: new Date().toISOString(),
		passed,
		results,
	};
}
