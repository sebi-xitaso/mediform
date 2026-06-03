/**
 * .mediform parsed questionnaire → FHIR Questionnaire compiler (SUC-10 compile phase).
 *
 * Maps a ParsedQuestionnaire to a FHIR R4 Questionnaire resource.
 * Validates LOINC and SNOMED code formats; collects errors without throwing.
 *
 * Traceability: issue #15, SUC-10, NFR-15.
 */

import type {
	CompileError,
	CompileResult,
	CompileWarning,
	FHIRAnswerOption,
	FHIRCoding,
	FHIRQuestionnaire,
	FHIRQuestionnaireItem,
	FHIRQuestionnaireStatus,
	ParsedQuestion,
	ParsedQuestionnaire,
	ParsedSection,
	QuestionnaireStatus,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile a ParsedQuestionnaire into a FHIR Questionnaire resource.
 *
 * Always returns a CompileResult; never throws.
 */
export function compileFhirQuestionnaire(
	questionnaire: ParsedQuestionnaire,
): CompileResult {
	const errors: CompileError[] = [];
	const warnings: CompileWarning[] = [];

	const { frontmatter, sections } = questionnaire;

	// Build top-level items
	const items: FHIRQuestionnaireItem[] = [];
	for (const section of sections) {
		const sectionItems = buildSectionItems(section, errors);
		items.push(...sectionItems);
	}

	const fhirQuestionnaire: FHIRQuestionnaire = {
		resourceType: "Questionnaire",
		title: frontmatter.title,
		...(frontmatter.description !== undefined
			? { description: frontmatter.description }
			: {}),
		version: frontmatter.version,
		status: mapStatus(frontmatter.status),
		...(items.length > 0 ? { item: items } : {}),
	};

	return {
		success: errors.length === 0,
		fhirQuestionnaire,
		errors,
		warnings,
	};
}

// ---------------------------------------------------------------------------
// Status mapping
// ---------------------------------------------------------------------------

function mapStatus(status: QuestionnaireStatus): FHIRQuestionnaireStatus {
	switch (status) {
		case "published":
			return "active";
		case "retired":
			return "retired";
		default:
			// draft, review, approved, rejected → FHIR draft
			return "draft";
	}
}

// ---------------------------------------------------------------------------
// Section and question item builders
// ---------------------------------------------------------------------------

function buildSectionItems(
	section: ParsedSection,
	errors: CompileError[],
): FHIRQuestionnaireItem[] {
	const questionItems = section.questions.map((q) =>
		buildQuestionItem(q, errors),
	);

	if (section.title === null) {
		// No explicit section — inline questions at the top level
		return questionItems;
	}

	// Named section → FHIR group item
	const groupItem: FHIRQuestionnaireItem = {
		linkId: slugToLinkId(section.title),
		text: section.title,
		type: "group",
		item: questionItems,
	};
	return [groupItem];
}

function buildQuestionItem(
	question: ParsedQuestion,
	errors: CompileError[],
): FHIRQuestionnaireItem {
	const item: FHIRQuestionnaireItem = {
		linkId: question.id,
		text: question.title,
		type: mapQuestionType(question.type),
		...(question.required ? { required: true } : {}),
	};

	// LOINC code → item.code
	if (question.loinc) {
		const loincCode = parseLoincCode(question.loinc);
		if (!loincCode) {
			errors.push({
				questionId: question.id,
				field: "loinc",
				message: `Question "${question.title}": malformed LOINC code "${question.loinc}"`,
			});
		} else {
			item.code = [loincCode];
		}
	}

	// Options → answerOption
	if (question.options && question.options.length > 0) {
		const answerOptions: FHIRAnswerOption[] = [];
		for (const opt of question.options) {
			if (opt.snomedCode) {
				const coding = parseSnomedCode(opt.snomedCode, opt.label);
				if (!coding) {
					errors.push({
						questionId: question.id,
						field: "options",
						message: `Question "${question.title}": malformed SNOMED code "${opt.snomedCode}"`,
					});
				} else {
					answerOptions.push({ valueCoding: coding });
				}
			} else {
				answerOptions.push({ valueString: opt.label });
			}
		}
		item.answerOption = answerOptions;
	}

	return item;
}

// ---------------------------------------------------------------------------
// Type mapping
// ---------------------------------------------------------------------------

function mapQuestionType(type: string): string {
	switch (type) {
		case "boolean":
			return "boolean";
		case "integer":
			return "integer";
		case "decimal":
			return "decimal";
		case "string":
			return "string";
		case "date":
			return "date";
		case "choice":
			return "choice";
		case "scale":
			return "integer"; // scale maps to integer in FHIR
		case "custom":
			return "attachment"; // custom renderers produce binary/attachment values
		default:
			return "string";
	}
}

// ---------------------------------------------------------------------------
// Code format validation and parsing
// ---------------------------------------------------------------------------

/**
 * LOINC codes are numeric with optional alphabetic suffix, separated by "-".
 * Example: "72514-3", "8867-4"
 */
const LOINC_PATTERN = /^\d{1,5}-\d{1}$/;

function parseLoincCode(raw: string): FHIRCoding | null {
	const trimmed = raw.trim();
	if (!LOINC_PATTERN.test(trimmed)) return null;
	return {
		system: "http://loinc.org",
		code: trimmed,
	};
}

/**
 * SNOMED codes in .mediform have the form "SNOMED:<numeric-code>".
 * Example: "SNOMED:25064002"
 */
const SNOMED_PREFIX = "SNOMED:";
const SNOMED_CODE_PATTERN = /^\d+$/;

function parseSnomedCode(raw: string, display: string): FHIRCoding | null {
	if (!raw.startsWith(SNOMED_PREFIX)) return null;
	const code = raw.slice(SNOMED_PREFIX.length);
	if (!SNOMED_CODE_PATTERN.test(code)) return null;
	return {
		system: "http://snomed.info/sct",
		code,
		display,
	};
}

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function slugToLinkId(text: string): string {
	return text
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
