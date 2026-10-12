// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { BRACKET_CLASSES, scanBrackets } from "./bracketColors.ts";

test("depth increases on openers and returns on closers", () => {
	const r = scanBrackets("({[]})", 0, [], 0, 100);
	expect(r.brackets.map((b) => b.depth)).toEqual([0, 1, 2, 2, 1, 0]);
	expect(r.depth).toBe(0);
});

test("depth cycles after six levels", () => {
	const r = scanBrackets("(".repeat(8), 0, [], 0, 100);
	expect(r.brackets.map((b) => b.depth)).toEqual([0, 1, 2, 3, 4, 5, 0, 1]);
	expect(BRACKET_CLASSES).toBe(6);
});

test("skipped ranges (strings, comments) are ignored", () => {
	const text = 'f("(", x) // )';
	const r = scanBrackets(
		text,
		100,
		[
			[102, 105],
			[112, 114],
		],
		0,
		100,
	);
	expect(r.brackets.map((b) => b.pos)).toEqual([101, 108]);
});

test("an unmatched closer never goes below depth 0", () => {
	const r = scanBrackets("))(", 0, [], 0, 100);
	expect(r.brackets.map((b) => b.depth)).toEqual([0, 0, 0]);
	expect(r.depth).toBe(1);
});

test("work is capped and reported", () => {
	const r = scanBrackets("()".repeat(10_000), 0, [], 0, 5_000);
	expect(r.brackets.length).toBe(5_000);
	expect(r.truncated).toBe(true);
});

test("a 10k-line viewport scans fast", () => {
	const text = "foo(bar[1], {a: (2)});\n".repeat(10_000);
	const t = performance.now();
	scanBrackets(text, 0, [], 0, Infinity);
	expect(performance.now() - t).toBeLessThan(500);
});
