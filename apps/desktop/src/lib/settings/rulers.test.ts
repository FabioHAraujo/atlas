// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { formatRulers, parseRulers } from "./rulers.ts";

test("commas and spaces separate columns; result is sorted and unique", () => {
	expect(parseRulers("100, 80 80,120")).toEqual([80, 100, 120]);
	expect(parseRulers("")).toEqual([]);
	expect(parseRulers("  ,  ")).toEqual([]);
});

test("words, zero, fractions and huge numbers are dropped", () => {
	expect(parseRulers("80 abc 0 1.5 501 -2 100")).toEqual([80, 100]);
});

test("format and parse round trip", () => {
	expect(formatRulers([80, 100])).toBe("80, 100");
	expect(parseRulers(formatRulers([72, 80, 120]))).toEqual([72, 80, 120]);
	expect(formatRulers([])).toBe("");
});
