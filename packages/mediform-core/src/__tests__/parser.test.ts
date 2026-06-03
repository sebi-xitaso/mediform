/**
 * TDD tests for the .mediform source parser (SUC-10 parse phase).
 *
 * Style: Chicago school — tests drive the parser via real inputs and assert
 * on the returned value structure. No mocks needed for a pure function.
 *
 * Traceability: issue #14, SUC-10 parse phase, NFR-14.
 */

import { describe, expect, it } from "bun:test";
import { parseMediform } from "../parser.js";

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const MINIMAL_SOURCE = `\
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

const SCALE_QUESTION = `\
---
title: Scale Test
version: 1.0
status: draft
---

# Pain Intensity

How intense?

- type: scale
- min: 0
- max: 10
- step: 1
- required: true
- maps-to: integer
`;

const SECTION_SOURCE = `\
---
title: Full Assessment
version: 1.0
status: draft
---

## General

# Overall Pain

General pain description.

- type: choice
- required: false
- maps-to: Coding
- options:
  - None | SNOMED:260413007

## Motor

# Motor Tracing

Trace the pattern.

- type: custom
- required: false
- maps-to: decimal
- renderer: \`\`\`js
  export default function({ onValue }) {
    onValue(42);
  }
  \`\`\`
`;

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

describe("parseMediform – frontmatter", () => {
  it("extracts title, description, version, and status", () => {
    const result = parseMediform(MINIMAL_SOURCE);
    expect(result.success).toBe(true);
    expect(result.questionnaire?.frontmatter.title).toBe("Pain Assessment");
    expect(result.questionnaire?.frontmatter.description).toBe(
      "Post-op pain check"
    );
    expect(result.questionnaire?.frontmatter.version).toBe("1.0");
    expect(result.questionnaire?.frontmatter.status).toBe("draft");
  });

  it("returns a parse error when frontmatter is missing", () => {
    const result = parseMediform("# No Frontmatter\n\n- type: string\n");
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toMatch(/frontmatter/i);
  });

  it("returns a parse error when frontmatter YAML is malformed", () => {
    const result = parseMediform("---\ntitle: [unclosed\n---\n");
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("returns a parse error when required title is absent", () => {
    const result = parseMediform("---\nversion: 1.0\nstatus: draft\n---\n");
    expect(result.success).toBe(false);
    expect(result.errors[0].message).toMatch(/title/i);
  });
});

// ---------------------------------------------------------------------------
// Section parsing
// ---------------------------------------------------------------------------

describe("parseMediform – sections", () => {
  it("wraps top-level questions in an implicit section when no ## heading exists", () => {
    const result = parseMediform(MINIMAL_SOURCE);
    expect(result.success).toBe(true);
    const sections = result.questionnaire!.sections;
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBeNull();
  });

  it("creates named sections for ## headings", () => {
    const result = parseMediform(SECTION_SOURCE);
    expect(result.success).toBe(true);
    const sections = result.questionnaire!.sections;
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe("General");
    expect(sections[1].title).toBe("Motor");
  });
});

// ---------------------------------------------------------------------------
// Question parsing
// ---------------------------------------------------------------------------

describe("parseMediform – questions", () => {
  it("parses a choice question with options", () => {
    const result = parseMediform(MINIMAL_SOURCE);
    expect(result.success).toBe(true);
    const q = result.questionnaire!.sections[0].questions[0];
    expect(q.title).toBe("Pain Location");
    expect(q.type).toBe("choice");
    expect(q.required).toBe(true);
    expect(q.mapsTo).toBe("Coding");
    expect(q.loinc).toBe("72514-3");
    expect(q.options).toHaveLength(2);
    expect(q.options![0].label).toBe("Head");
    expect(q.options![0].snomedCode).toBe("SNOMED:25064002");
  });

  it("parses prose below a # heading as description", () => {
    const result = parseMediform(MINIMAL_SOURCE);
    const q = result.questionnaire!.sections[0].questions[0];
    expect(q.description).toBe("Where do you feel pain?");
  });

  it("parses a scale question with min/max/step in config", () => {
    const result = parseMediform(SCALE_QUESTION);
    expect(result.success).toBe(true);
    const q = result.questionnaire!.sections[0].questions[0];
    expect(q.type).toBe("scale");
    expect(q.config["min"]).toBe(0);
    expect(q.config["max"]).toBe(10);
    expect(q.config["step"]).toBe(1);
  });

  it("parses a custom renderer block", () => {
    const result = parseMediform(SECTION_SOURCE);
    expect(result.success).toBe(true);
    const q = result.questionnaire!.sections[1].questions[0];
    expect(q.type).toBe("custom");
    expect(q.renderer).toContain("onValue");
  });

  it("generates a stable id from the question title", () => {
    const result = parseMediform(MINIMAL_SOURCE);
    const q = result.questionnaire!.sections[0].questions[0];
    expect(q.id).toBeTruthy();
    expect(typeof q.id).toBe("string");
  });

  it("returns an error when type is missing from a question", () => {
    const source = `---
title: T
version: 1.0
status: draft
---

# No Type

- required: true
- maps-to: string
`;
    const result = parseMediform(source);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.message.match(/type/i))).toBe(true);
  });

  it("returns an error when type is unknown", () => {
    const source = `---
title: T
version: 1.0
status: draft
---

# Bad Type

- type: wizard
- maps-to: string
`;
    const result = parseMediform(source);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.message.match(/type/i))).toBe(true);
  });

  it("returns an error when required is not a boolean", () => {
    const source = `---
title: T
version: 1.0
status: draft
---

# Q

- type: string
- required: maybe
- maps-to: string
`;
    const result = parseMediform(source);
    expect(result.success).toBe(false);
    expect(result.errors.some((e) => e.message.match(/required/i))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Error location
// ---------------------------------------------------------------------------

describe("parseMediform – error locations", () => {
  it("includes a line number in parse errors", () => {
    const result = parseMediform("# No Frontmatter\n\n- type: string\n");
    expect(result.errors[0].line).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// NFR-14: performance
// ---------------------------------------------------------------------------

describe("parseMediform – NFR-14 performance", () => {
  it("parses a 50KB .mediform file within 100ms", () => {
    // Build a synthetic 50KB file
    const question = `\n# Question {{n}}\n\nDescription text.\n\n- type: choice\n- required: true\n- maps-to: Coding\n- options:\n  - Option A | SNOMED:1\n  - Option B | SNOMED:2\n`;
    const header = `---\ntitle: Large Form\nversion: 1.0\nstatus: draft\n---\n`;
    let body = "";
    let i = 0;
    while (header.length + body.length < 50_000) {
      body += question.replace("{{n}}", String(++i));
    }
    const source = header + body;
    expect(source.length).toBeGreaterThanOrEqual(50_000);

    const start = performance.now();
    parseMediform(source);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(100);
  });
});
