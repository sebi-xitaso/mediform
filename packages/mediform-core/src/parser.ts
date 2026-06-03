/**
 * .mediform source parser — SUC-10 parse phase.
 *
 * Converts raw .mediform text into a ParsedQuestionnaire structure.
 * Parsing is intentionally permissive: syntax errors are collected and
 * returned alongside any partial result, allowing callers (e.g. SUC-06) to
 * store a draft even when validation fails (BR-014).
 *
 * Traceability: issue #14, SUC-10, NFR-14.
 */

import type {
	AnswerOption,
	MapsToType,
	ParsedQuestion,
	ParsedQuestionnaire,
	ParsedQuestionnaireFrontmatter,
	ParsedSection,
	ParseError,
	ParseWarning,
	QuestionnaireStatus,
	QuestionType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ParseResult {
	success: boolean;
	/** Present when at least the structural parse succeeded. */
	questionnaire?: ParsedQuestionnaire;
	errors: ParseError[];
	warnings: ParseWarning[];
}

/**
 * Parse a raw .mediform string into a structured representation.
 *
 * Always returns a ParseResult; never throws.
 */
export function parseMediform(source: string): ParseResult {
	const errors: ParseError[] = [];
	const warnings: ParseWarning[] = [];

	// -------------------------------------------------------------------------
	// Step 1: split frontmatter from body
	// -------------------------------------------------------------------------
	const { frontmatterText, bodyText, frontmatterEndLine } =
		splitFrontmatter(source);

	if (frontmatterText === null) {
		errors.push({
			line: 1,
			message: "Missing frontmatter: file must start with ---",
		});
		return { success: false, errors, warnings };
	}

	// -------------------------------------------------------------------------
	// Step 2: parse YAML frontmatter
	// -------------------------------------------------------------------------
	let frontmatter: ParsedQuestionnaireFrontmatter | null = null;
	try {
		frontmatter = parseFrontmatterYaml(frontmatterText, errors);
	} catch {
		errors.push({ line: 1, message: "Malformed YAML frontmatter" });
		return { success: false, errors, warnings };
	}

	if (!frontmatter) {
		return { success: false, errors, warnings };
	}

	// -------------------------------------------------------------------------
	// Step 3: parse body into sections and questions
	// -------------------------------------------------------------------------
	const sections = parseBody(bodyText, frontmatterEndLine, errors);

	const success = errors.length === 0;
	const questionnaire: ParsedQuestionnaire = { frontmatter, sections };

	return { success, questionnaire, errors, warnings };
}

// ---------------------------------------------------------------------------
// Frontmatter splitting
// ---------------------------------------------------------------------------

interface SplitResult {
	frontmatterText: string | null;
	bodyText: string;
	/** Line number of the closing --- delimiter (1-indexed). */
	frontmatterEndLine: number;
}

function splitFrontmatter(source: string): SplitResult {
	const lines = source.split("\n");

	if (lines[0]?.trim() !== "---") {
		return { frontmatterText: null, bodyText: source, frontmatterEndLine: 0 };
	}

	// Find closing ---
	let closingIndex = -1;
	for (let i = 1; i < lines.length; i++) {
		if (lines[i]?.trim() === "---") {
			closingIndex = i;
			break;
		}
	}

	if (closingIndex === -1) {
		return { frontmatterText: null, bodyText: source, frontmatterEndLine: 0 };
	}

	const frontmatterText = lines.slice(1, closingIndex).join("\n");
	const bodyText = lines.slice(closingIndex + 1).join("\n");

	return { frontmatterText, bodyText, frontmatterEndLine: closingIndex + 1 };
}

// ---------------------------------------------------------------------------
// YAML frontmatter parser (no external dependencies — hand-rolled for
// the small, predictable frontmatter schema).
// ---------------------------------------------------------------------------

const VALID_STATUSES = new Set<string>([
	"draft",
	"review",
	"approved",
	"published",
	"rejected",
	"retired",
]);

function parseFrontmatterYaml(
	text: string,
	errors: ParseError[],
): ParsedQuestionnaireFrontmatter | null {
	// Parse simple key: value pairs (no nesting in frontmatter)
	const kvMap = parseSimpleYaml(text);

	let hasError = false;

	if (!kvMap.title || typeof kvMap.title !== "string") {
		errors.push({
			line: 1,
			message: "Frontmatter missing required field: title",
		});
		hasError = true;
	}
	if (kvMap.version === undefined || kvMap.version === null) {
		errors.push({
			line: 1,
			message: "Frontmatter missing required field: version",
		});
		hasError = true;
	}
	if (!kvMap.status || typeof kvMap.status !== "string") {
		errors.push({
			line: 1,
			message: "Frontmatter missing required field: status",
		});
		hasError = true;
	} else if (!VALID_STATUSES.has(kvMap.status)) {
		errors.push({
			line: 1,
			message: `Frontmatter status "${kvMap.status}" is not a valid QuestionnaireStatus`,
		});
		hasError = true;
	}

	if (hasError) return null;

	return {
		title: kvMap.title as string,
		description: (kvMap.description as string | undefined) ?? undefined,
		version: String(kvMap.version),
		status: kvMap.status as QuestionnaireStatus,
	};
}

/**
 * Minimal YAML parser for flat key-value pairs.
 * Supports: string values, numbers, and quoted strings.
 * Throws on structurally invalid input (unclosed brackets etc.).
 */
function parseSimpleYaml(text: string): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	const lines = text.split("\n");

	for (const line of lines) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const colonIdx = trimmed.indexOf(":");
		if (colonIdx === -1) continue;

		const key = trimmed.slice(0, colonIdx).trim();
		const rawValue = trimmed.slice(colonIdx + 1).trim();

		// Detect unclosed brackets/braces (malformed YAML indicator)
		if (/[[{]/.test(rawValue)) {
			const openCount = (rawValue.match(/[[{]/g) ?? []).length;
			const closeCount = (rawValue.match(/[\]}]/g) ?? []).length;
			if (openCount !== closeCount) {
				throw new Error("Malformed YAML: unclosed bracket");
			}
		}

		result[key] = parseYamlScalar(rawValue);
	}

	return result;
}

function parseYamlScalar(raw: string): unknown {
	if (raw === "true") return true;
	if (raw === "false") return false;
	if (raw === "null" || raw === "~" || raw === "") return null;

	// Quoted string
	if (
		(raw.startsWith('"') && raw.endsWith('"')) ||
		(raw.startsWith("'") && raw.endsWith("'"))
	) {
		return raw.slice(1, -1);
	}

	// Number — only convert if the string representation is identical (no loss)
	const num = Number(raw);
	if (!Number.isNaN(num) && raw !== "" && String(num) === raw) return num;

	return raw;
}

// ---------------------------------------------------------------------------
// Body parser
// ---------------------------------------------------------------------------

const VALID_TYPES = new Set<string>([
	"boolean",
	"integer",
	"decimal",
	"string",
	"date",
	"choice",
	"scale",
	"custom",
]);

const VALID_MAPS_TO = new Set<string>([
	"boolean",
	"integer",
	"decimal",
	"string",
	"date",
	"Coding",
	"Quantity",
]);

function parseBody(
	body: string,
	lineOffset: number,
	errors: ParseError[],
): ParsedSection[] {
	const lines = body.split("\n");
	const sections: ParsedSection[] = [];

	let currentSection: ParsedSection | null = null;
	let currentQuestion: Partial<RawQuestion> | null = null;
	let inOptionsBlock = false;
	let inRendererBlock = false;
	let rendererLines: string[] = [];

	const finalizeQuestion = () => {
		if (!currentQuestion) return;
		if (!currentSection) {
			// Implicit section for top-level questions
			currentSection = { title: null, questions: [] };
			sections.push(currentSection);
		}
		const q = buildQuestion(
			currentQuestion,
			lineOffset + (currentQuestion.line ?? 0),
			errors,
		);
		if (q) currentSection.questions.push(q);
		currentQuestion = null;
		inOptionsBlock = false;
		inRendererBlock = false;
		rendererLines = [];
	};

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? "";
		const _lineNum = lineOffset + i + 1;

		// --- Section heading ##
		if (line.startsWith("## ")) {
			finalizeQuestion();
			currentSection = { title: line.slice(3).trim(), questions: [] };
			sections.push(currentSection);
			continue;
		}

		// --- Question heading #
		if (line.startsWith("# ")) {
			finalizeQuestion();
			currentQuestion = {
				title: line.slice(2).trim(),
				line: i + 1,
				metadata: {},
				optionLines: [],
				descLines: [],
			};
			continue;
		}

		if (!currentQuestion) continue;

		// --- Renderer block end
		if (inRendererBlock) {
			if (line.trim() === "```") {
				currentQuestion.renderer = rendererLines.join("\n").trim();
				inRendererBlock = false;
			} else {
				rendererLines.push(line);
			}
			continue;
		}

		// --- Metadata line: starts with "- key: value" or "- key:"
		if (line.match(/^- \w/)) {
			inOptionsBlock = false;
			const metaLine = line.slice(2).trim();
			const colonIdx = metaLine.indexOf(":");
			if (colonIdx !== -1) {
				const key = metaLine.slice(0, colonIdx).trim();
				const val = metaLine.slice(colonIdx + 1).trim();

				if (key === "options" && val === "") {
					inOptionsBlock = true;
					continue;
				}

				if (key === "renderer" && val.endsWith("```js")) {
					inRendererBlock = true;
					rendererLines = [];
					continue;
				}

				if (key === "renderer" && val === "```js") {
					inRendererBlock = true;
					rendererLines = [];
					continue;
				}

				currentQuestion.metadata![key] = val;
			}
			continue;
		}

		// --- Options sub-item: "  - label | SNOMED:xxx"
		if (inOptionsBlock && line.match(/^ {2}- /)) {
			currentQuestion.optionLines?.push(line.trim().slice(2));
			continue;
		}

		// --- Prose (description)
		const trimmed = line.trim();
		if (trimmed && !trimmed.startsWith("-")) {
			currentQuestion.descLines?.push(trimmed);
		}
	}

	finalizeQuestion();
	return sections;
}

interface RawQuestion {
	title: string;
	line: number;
	metadata: Record<string, string>;
	optionLines: string[];
	descLines: string[];
	renderer?: string;
}

function buildQuestion(
	raw: Partial<RawQuestion>,
	lineNum: number,
	errors: ParseError[],
): ParsedQuestion | null {
	const meta = raw.metadata ?? {};
	let hasError = false;

	// Validate type
	const rawType = meta.type;
	if (!rawType) {
		errors.push({
			line: lineNum,
			message: `Question "${raw.title}": missing required field "type"`,
		});
		hasError = true;
	} else if (!VALID_TYPES.has(rawType)) {
		errors.push({
			line: lineNum,
			message: `Question "${raw.title}": unknown type "${rawType}"`,
		});
		hasError = true;
	}

	// Validate required
	let required = false;
	const rawRequired = meta.required;
	if (rawRequired !== undefined) {
		if (rawRequired !== "true" && rawRequired !== "false") {
			errors.push({
				line: lineNum,
				message: `Question "${raw.title}": "required" must be true or false, got "${rawRequired}"`,
			});
			hasError = true;
		} else {
			required = rawRequired === "true";
		}
	}

	// Validate maps-to
	const rawMapsTo = meta["maps-to"];
	if (rawMapsTo && !VALID_MAPS_TO.has(rawMapsTo)) {
		errors.push({
			line: lineNum,
			message: `Question "${raw.title}": unknown maps-to "${rawMapsTo}"`,
		});
		hasError = true;
	}

	if (hasError) return null;

	// Parse options
	const options: AnswerOption[] | undefined =
		raw.optionLines && raw.optionLines.length > 0
			? raw.optionLines.map(parseOption)
			: undefined;

	// Parse numeric config fields
	const config: Record<string, unknown> = {};
	for (const key of ["min", "max", "step"]) {
		if (meta[key] !== undefined) {
			const n = Number(meta[key]);
			config[key] = Number.isNaN(n) ? meta[key] : n;
		}
	}
	if (meta.unit) config.unit = meta.unit;

	// Generate id from title
	const id = slugify(raw.title ?? "question");

	const description = raw.descLines?.join(" ") || undefined;

	return {
		id,
		title: raw.title ?? "",
		description,
		type: (rawType as QuestionType) ?? "string",
		required,
		mapsTo: (rawMapsTo as MapsToType) ?? "string",
		loinc: meta.loinc ?? undefined,
		options,
		config,
		renderer: raw.renderer ?? undefined,
	};
}

function parseOption(raw: string): AnswerOption {
	const pipeIdx = raw.indexOf("|");
	if (pipeIdx === -1) {
		return { label: raw.trim() };
	}
	const label = raw.slice(0, pipeIdx).trim();
	const code = raw.slice(pipeIdx + 1).trim();
	return { label, snomedCode: code || undefined };
}

function slugify(title: string): string {
	return title
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
}
