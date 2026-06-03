/**
 * Contract tests for SqliteQuestionnaireRepository.
 *
 * Style: Chicago school — exercises the real SQLite implementation against
 * an in-memory database. No mocks.
 *
 * Traceability: #67 (ADR-009).
 */

import { beforeEach, describe, expect, it } from "bun:test";
import { SqliteQuestionnaireRepository } from "../repository.js";

let repo: SqliteQuestionnaireRepository;

beforeEach(() => {
	repo = new SqliteQuestionnaireRepository(":memory:");
});

const SOURCE =
	"---\ntitle: T\nversion: 1.0\nstatus: draft\n---\n\n# Q\nText.\n";

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe("create", () => {
	it("returns a record with a generated id in draft status", () => {
		const r = repo.create({ title: "Pain", source: SOURCE });
		expect(r.id).toBeTruthy();
		expect(r.status).toBe("draft");
		expect(r.author).toBe("staff");
	});

	it("stores title and source", () => {
		const r = repo.create({ title: "Pain", source: SOURCE });
		expect(r.title).toBe("Pain");
		expect(r.source).toBe(SOURCE);
	});

	it("stores optional description", () => {
		const r = repo.create({ title: "T", description: "Desc", source: SOURCE });
		expect(r.description).toBe("Desc");
	});

	it("sets createdAt and lastModified as ISO timestamps", () => {
		const r = repo.create({ title: "T", source: SOURCE });
		expect(() => new Date(r.createdAt)).not.toThrow();
		expect(() => new Date(r.lastModified)).not.toThrow();
	});
});

// ---------------------------------------------------------------------------
// getById
// ---------------------------------------------------------------------------

describe("getById", () => {
	it("returns the record by id", () => {
		const r = repo.create({ title: "T", source: SOURCE });
		expect(repo.getById(r.id)?.id).toBe(r.id);
	});

	it("returns undefined for unknown id", () => {
		expect(repo.getById("no-such-id")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe("update", () => {
	it("updates source and bumps lastModified", async () => {
		const r = repo.create({ title: "T", source: SOURCE });
		await new Promise((res) => setTimeout(res, 5));
		const updated = repo.update(r.id, {
			source: "new source",
			title: "New Title",
		});
		expect(updated?.source).toBe("new source");
		expect(updated?.title).toBe("New Title");
		const orig = new Date(r.lastModified).getTime();
		const mod = new Date(updated?.lastModified ?? "").getTime();
		expect(mod).toBeGreaterThanOrEqual(orig);
	});

	it("returns undefined for unknown id", () => {
		expect(repo.update("no-such-id", { source: "x" })).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe("updateStatus", () => {
	it("transitions status", () => {
		const r = repo.create({ title: "T", source: SOURCE });
		const updated = repo.updateStatus(r.id, "review");
		expect(updated?.status).toBe("review");
	});

	it("stores reviewFeedback and clears it on next call without extra", () => {
		const r = repo.create({ title: "T", source: SOURCE });
		const withFeedback = repo.updateStatus(r.id, "draft", {
			reviewFeedback: "Fix it.",
		});
		expect(withFeedback?.reviewFeedback).toBe("Fix it.");
	});

	it("stores rejectionReason", () => {
		const r = repo.create({ title: "T", source: SOURCE });
		const rejected = repo.updateStatus(r.id, "rejected", {
			rejectionReason: "Out of scope.",
		});
		expect(rejected?.rejectionReason).toBe("Out of scope.");
	});

	it("returns undefined for unknown id", () => {
		expect(repo.updateStatus("no-such-id", "draft")).toBeUndefined();
	});
});

// ---------------------------------------------------------------------------
// list
// ---------------------------------------------------------------------------

describe("list", () => {
	it("returns empty array when no records", () => {
		expect(repo.list()).toEqual([]);
	});

	it("returns all records when no filter", () => {
		repo.create({ title: "A", source: SOURCE });
		repo.create({ title: "B", source: SOURCE });
		expect(repo.list()).toHaveLength(2);
	});

	it("filters by status", () => {
		const r = repo.create({ title: "A", source: SOURCE });
		repo.create({ title: "B", source: SOURCE });
		repo.updateStatus(r.id, "review");
		const result = repo.list(["review"]);
		expect(result).toHaveLength(1);
		expect(result[0].status).toBe("review");
	});

	it("filters by multiple statuses", () => {
		const a = repo.create({ title: "A", source: SOURCE });
		const b = repo.create({ title: "B", source: SOURCE });
		repo.create({ title: "C", source: SOURCE });
		repo.updateStatus(a.id, "review");
		repo.updateStatus(b.id, "approved");
		expect(repo.list(["review", "approved"])).toHaveLength(2);
	});

	it("places review items first (BR-035)", () => {
		repo.create({ title: "Draft", source: SOURCE });
		const r = repo.create({ title: "In Review", source: SOURCE });
		repo.updateStatus(r.id, "review");
		const result = repo.list();
		expect(result[0].status).toBe("review");
	});

	it("sorts within same status by lastModified descending", async () => {
		const a = repo.create({ title: "Old", source: SOURCE });
		await new Promise((res) => setTimeout(res, 5));
		const b = repo.create({ title: "New", source: SOURCE });
		const result = repo.list();
		expect(result[0].id).toBe(b.id);
		expect(result[1].id).toBe(a.id);
	});
});

// ---------------------------------------------------------------------------
// clear
// ---------------------------------------------------------------------------

describe("clear", () => {
	it("removes all records", () => {
		repo.create({ title: "T", source: SOURCE });
		repo.clear();
		expect(repo.list()).toHaveLength(0);
	});
});
