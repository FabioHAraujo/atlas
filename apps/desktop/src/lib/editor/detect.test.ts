// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import {
	applySavePolicy,
	detectEol,
	detectIndent,
	hasFinalNewline,
	normalizeEol,
	trimTrailingWhitespace,
} from "./detect.ts";

const FALLBACK = { style: "space", size: 4 } as const;

test("detectEol: pure endings, none, and mixed", () => {
	expect(detectEol("a\nb\nc")).toBe("lf");
	expect(detectEol("a\r\nb\r\n")).toBe("crlf");
	expect(detectEol("a\rb\r")).toBe("cr");
	expect(detectEol("no breaks")).toBe("lf");
	expect(detectEol("")).toBe("lf");
	expect(detectEol("a\r\nb\nc")).toBe("mixed");
	expect(detectEol("a\rb\nc")).toBe("mixed");
	expect(detectEol("a\r\nb\rc")).toBe("mixed");
});

test("detectEol only samples the first megabyte", () => {
	const head = "a\n".repeat(600_000); // 1.2 MB of LF
	expect(detectEol(head + "b\r\n")).toBe("lf");
});

test("detectIndent: 4 spaces, 2 spaces, 8-wide", () => {
	const four = "fn a() {\n    if x {\n        y();\n    }\n    z();\n}\n";
	expect(detectIndent(four, { style: "space", size: 2 })).toEqual({ style: "space", size: 4 });
	const two = "a:\n  b:\n    c: 1\n    d: 2\n  e: 3\nf: 4\n";
	expect(detectIndent(two, FALLBACK)).toEqual({ style: "space", size: 2 });
});

test("detectIndent: tabs when most indented lines start with a tab", () => {
	const text = "a {\n\tb;\n\tc {\n\t\td;\n\t}\n}\n";
	expect(detectIndent(text, FALLBACK)).toEqual({ style: "tab", size: 4 });
	// the configured size is kept when the fallback is already tabs
	expect(detectIndent(text, { style: "tab", size: 8 })).toEqual({ style: "tab", size: 8 });
});

test("detectIndent: a few tab lines among spaces stay spaces", () => {
	const text = "a\n  b\n  c\n\td\n  e\n";
	expect(detectIndent(text, FALLBACK)).toEqual({ style: "space", size: 2 });
});

test("detectIndent: no evidence returns the fallback", () => {
	expect(detectIndent("a\nb\nc\n", { style: "space", size: 3 })).toEqual({ style: "space", size: 3 });
	expect(detectIndent("", FALLBACK)).toEqual(FALLBACK);
	expect(detectIndent("a\n\n\n   \nb\n", FALLBACK)).toEqual(FALLBACK);
});

test("detectIndent: blank and CRLF lines do not skew the result", () => {
	const text = "a\r\n  b\r\n\r\n  c\r\n    d\r\n";
	expect(detectIndent(text, FALLBACK)).toEqual({ style: "space", size: 2 });
});

test("detectIndent: continuation alignment deltas above 8 are ignored", () => {
	const text = "x\n    y\n                          z\n    w\n";
	expect(detectIndent(text, FALLBACK)).toEqual({ style: "space", size: 4 });
});

test("normalizeEol converts every ending and leaves the target alone", () => {
	expect(normalizeEol("a\nb\r\nc\rd", "lf")).toBe("a\nb\nc\nd");
	expect(normalizeEol("a\nb\r\nc\rd", "crlf")).toBe("a\r\nb\r\nc\r\nd");
	expect(normalizeEol("a\nb\r\nc\rd", "cr")).toBe("a\rb\rc\rd");
	expect(normalizeEol("a\r\nb\r\n", "crlf")).toBe("a\r\nb\r\n");
	expect(normalizeEol("one line", "crlf")).toBe("one line");
	expect(normalizeEol("", "lf")).toBe("");
	expect(normalizeEol("\n\n", "crlf")).toBe("\r\n\r\n");
});

test("hasFinalNewline", () => {
	expect(hasFinalNewline("a\n")).toBe(true);
	expect(hasFinalNewline("a\r\n")).toBe(true);
	expect(hasFinalNewline("a\r")).toBe(true);
	expect(hasFinalNewline("a")).toBe(false);
	expect(hasFinalNewline("")).toBe(false);
});

test("trimTrailingWhitespace: every line, every ending kind, last line", () => {
	expect(trimTrailingWhitespace("a  \nb\t\r\nc \rd  ")).toBe("a\nb\r\nc\rd");
	expect(trimTrailingWhitespace("  keep leading  \n")).toBe("  keep leading\n");
	expect(trimTrailingWhitespace("   \n\t\n")).toBe("\n\n");
	expect(trimTrailingWhitespace("")).toBe("");
});

test("trimTrailingWhitespace: skipLines (set or array) are untouched", () => {
	expect(trimTrailingWhitespace("a  \nb  \nc  ", { skipLines: new Set([1]) })).toBe("a\nb  \nc");
	expect(trimTrailingWhitespace("a  \nb  ", { skipLines: [0] })).toBe("a  \nb");
});

test("trimTrailingWhitespace returns the same string when clean", () => {
	const s = "a\nb\n";
	expect(trimTrailingWhitespace(s)).toBe(s);
});

test("applySavePolicy combines trim, final newline and eol", () => {
	expect(applySavePolicy("a  \nb", { trim: true, finalNewline: true, eol: "lf" })).toBe("a\nb\n");
	expect(applySavePolicy("a  \nb", { trim: true, finalNewline: true, eol: "crlf" })).toBe("a\r\nb\r\n");
	expect(applySavePolicy("a  \nb", { trim: false, finalNewline: false, eol: "lf" })).toBe("a  \nb");
	expect(applySavePolicy("a\n", { trim: true, finalNewline: true, eol: "lf" })).toBe("a\n");
	expect(applySavePolicy("", { trim: true, finalNewline: true, eol: "lf" })).toBe("");
	expect(applySavePolicy("a\r\nb\n", { trim: false, finalNewline: false, eol: "cr" })).toBe("a\rb\r");
});

test("a 5 MB minified single line stays fast in every scan", () => {
	const line = "var a=1;".repeat(625_000); // 5 MB, no newline
	const t0 = performance.now();
	expect(detectEol(line)).toBe("lf");
	expect(detectIndent(line, FALLBACK)).toEqual(FALLBACK);
	expect(trimTrailingWhitespace(line)).toBe(line);
	expect(normalizeEol(line, "crlf")).toBe(line);
	expect(applySavePolicy(line, { trim: true, finalNewline: false, eol: "lf" })).toBe(line);
	expect(performance.now() - t0).toBeLessThan(500);
});

test("a long run of trailing spaces does not blow up", () => {
	const s = "x" + " ".repeat(2_000_000) + "\ny";
	const t0 = performance.now();
	expect(trimTrailingWhitespace(s)).toBe("x\ny");
	expect(performance.now() - t0).toBeLessThan(500);
});
