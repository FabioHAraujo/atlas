// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { Crumbs } from "./breadcrumbs.ts";

test("keeps the newest N, oldest first", () => {
	const c = new Crumbs(3);
	for (let i = 0; i < 5; i++) c.add(`e${i}`, i);
	expect(c.snapshot().map((b) => b.text)).toEqual(["e2", "e3", "e4"]);
});

test("a burst of the same text collapses into one entry with a count", () => {
	const c = new Crumbs(10);
	c.add("lsp_status", 1);
	c.add("lsp_status", 2);
	c.add("lsp_status", 3);
	c.add("other", 4);
	expect(c.snapshot().map((b) => b.text)).toEqual(["lsp_status ×3", "other"]);
});

test("text is bounded and single-line", () => {
	const c = new Crumbs(10);
	c.add("a\nb" + "x".repeat(1000), 1);
	const t = c.snapshot()[0].text;
	expect(t.includes("\n")).toBe(false);
	expect(t.length).toBeLessThanOrEqual(200);
});

test("never records file contents or tokens: query secrets are dropped", () => {
	const c = new Crumbs(10);
	c.add("GET /x?token=abc123&a=1", 1);
	expect(c.snapshot()[0].text).not.toContain("abc123");
});
