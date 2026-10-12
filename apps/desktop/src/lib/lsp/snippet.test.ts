// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { lspSnippetToCm } from "./snippet.ts";

const cm = (s: string) => lspSnippetToCm(s).template;

test("tab stops and defaults map to CodeMirror fields, $0 to the final position", () => {
	expect(cm("println!(${1:msg}, $2)$0")).toBe("println!(${1:msg}, ${2})${0}");
	expect(cm("foo($1)")).toBe("foo(${1})");
});

test("the same number mirrors (CodeMirror joins fields by number)", () => {
	expect(cm("${1:x} = $1")).toBe("${1:x} = ${1}");
});

test("choices keep the first option", () => {
	expect(cm("let ${1|mut,ref|} x")).toBe("let ${1:mut} x");
});

test("nested placeholders flatten to their default text", () => {
	expect(cm("fn ${1:name}(${2:a: ${3:T}})")).toBe("fn ${1:name}(${2:a: T})");
});

test("literal braces are escaped, `${` in plain text is defused", () => {
	expect(cm("if x { y }")).toBe("if x \\{ y \\}");
	expect(cm("\\${notfield}")).toBe("$\\{notfield\\}");
	expect(cm("`$\\{x\\}`")).toBe("`$\\{x\\}`");
});

test("variables expand to their default or nothing; stray $ stays literal", () => {
	expect(cm("$TM_FILENAME x ${UNKNOWN:fallback} cost $")).toBe(" x fallback cost $");
});

test("plain is true only without any tab stop", () => {
	expect(lspSnippetToCm("foo()").plain).toBe(true);
	expect(lspSnippetToCm("foo($0)").plain).toBe(false);
	expect(lspSnippetToCm("foo($1)").plain).toBe(false);
});
