// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { dirtyPage, pagesChanged } from "./pageDirty.ts";

const rec = (over) => ({
	type: "attributes",
	attributeName: "class",
	targetIsLayerRoot: false,
	page: "a",
	...over,
});

test("a role flip on the layer root (class / inert / data-role / aria-hidden) never dirties its page", () => {
	for (const attributeName of ["class", "inert", "data-role", "data-side", "aria-hidden", "style"])
		expect(dirtyPage(rec({ attributeName, targetIsLayerRoot: true }))).toBeNull();
});

test("a change inside a page dirties that page and only that one", () => {
	expect(dirtyPage(rec({ type: "childList" }))).toBe("a");
	expect(dirtyPage(rec({ type: "characterData" }))).toBe("a");
	expect(dirtyPage(rec({ attributeName: "class", page: "b" }))).toBe("b");
	expect(dirtyPage(rec({ page: null }))).toBeNull();
});

test("a layer root's own childList change counts (a page mounted its content)", () => {
	expect(dirtyPage(rec({ type: "childList", targetIsLayerRoot: true }))).toBe("a");
});

test("pages are re-pushed only when the order or the rect actually changed", () => {
	const a = { order: ["a", "b"], rect: [8, 8, 100, 100] };
	expect(pagesChanged(null, a)).toBe(true);
	expect(pagesChanged(a, { order: ["a", "b"], rect: [8, 8, 100, 100] })).toBe(false);
	expect(pagesChanged(a, { order: ["b", "a"], rect: [8, 8, 100, 100] })).toBe(true);
	expect(pagesChanged(a, { order: ["a", "b"], rect: [8, 8, 101, 100] })).toBe(true);
	// active does not matter to native: it only needs order + rect to place layers
	expect(pagesChanged({ ...a, active: "a" }, { ...a, active: "b" })).toBe(false);
});
