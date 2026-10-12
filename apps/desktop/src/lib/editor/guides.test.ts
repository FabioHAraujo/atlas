// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { activeGuide, indentColumns, indentLevels, whitespaceRanges } from "./guides.ts";

test("indentColumns counts spaces, tabs to the next stop, and flags blank lines", () => {
	expect(indentColumns("    x", 4)).toBe(4);
	expect(indentColumns("\tx", 4)).toBe(4);
	expect(indentColumns("  \tx", 4)).toBe(4);
	expect(indentColumns("   ", 4)).toBe(-1);
	expect(indentColumns("", 4)).toBe(-1);
});

test("indentLevels carries a guide through blank lines inside a block", () => {
	const lines = ["fn a() {", "    x;", "", "    y;", "}", "", "z"];
	expect(indentLevels(lines, 4, 4)).toEqual([0, 1, 1, 1, 0, 0, 0]);
});

test("indentLevels uses the neighbours outside the slice for edge blanks", () => {
	expect(indentLevels(["", "a"], 4, 4, 2, 0)).toEqual([0, 0]);
	expect(indentLevels(["", ""], 4, 4, 2, 3)).toEqual([2, 2]);
});

test("activeGuide spans the consecutive lines at least as deep", () => {
	const levels = [0, 1, 2, 2, 1, 1, 0, 1];
	expect(activeGuide(levels, 2)).toEqual({ level: 2, from: 2, to: 3 });
	expect(activeGuide(levels, 4)).toEqual({ level: 1, from: 1, to: 5 });
	expect(activeGuide(levels, 0)).toBeNull();
});

test("whitespaceRanges finds spaces and tabs, optionally only inside ranges", () => {
	const r = whitespaceRanges("a b\tc", 10);
	expect(r).toEqual([
		{ from: 11, to: 12, kind: "space" },
		{ from: 13, to: 14, kind: "tab" },
	]);
	expect(whitespaceRanges("a b\tc", 10, [[12, 15]])).toEqual([{ from: 13, to: 14, kind: "tab" }]);
	expect(whitespaceRanges("a b", 0, [[50, 60]])).toEqual([]);
});
