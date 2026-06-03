/**
 * Maps a ParsedQuestionnaire into a PatientQuestionnaire (the patient-facing
 * view). Strips FHIR-internal fields (LOINC, SNOMED, maps-to) as per BR-003.
 *
 * Traceability: SUC-01, SUC-05 (BR-012).
 */

import type {
	ParsedQuestionnaire,
	PatientQuestion,
	PatientQuestionnaire,
	PatientSection,
} from "mediform-core";

export function toPatientQuestionnaire(
	id: string,
	parsed: ParsedQuestionnaire,
): PatientQuestionnaire {
	const { frontmatter, sections } = parsed;

	const patientSections: PatientSection[] = sections.map((section) => ({
		title: section.title,
		questions: section.questions.map((q): PatientQuestion => {
			const config: Record<string, unknown> = { ...(q.config ?? {}) };
			if (q.options) {
				config.options = q.options.map((o) => ({ label: o.label }));
			}
			return {
				id: q.id,
				title: q.title,
				...(q.description !== undefined ? { description: q.description } : {}),
				type: q.type,
				required: q.required,
				config,
				...(q.renderer !== undefined ? { renderer: q.renderer } : {}),
			};
		}),
	}));

	return {
		id,
		title: frontmatter.title,
		...(frontmatter.description !== undefined
			? { description: frontmatter.description }
			: {}),
		sections: patientSections,
	};
}
