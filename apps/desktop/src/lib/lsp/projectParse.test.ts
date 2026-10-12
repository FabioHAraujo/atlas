// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { parseProjectSettings } from "./projectParse.ts";

test("valid file yields the lsp table", () => {
	expect(parseProjectSettings('{"lsp":{"go":{"disabled":true}}}')).toEqual({
		lsp: { go: { disabled: true } },
	});
});

test("file without lsp is fine and silent", () => {
	expect(parseProjectSettings("{}")).toEqual({ lsp: {} });
	expect(parseProjectSettings('{"other":1}')).toEqual({ lsp: {} });
});

test("invalid JSON warns in one line and never throws", () => {
	const r = parseProjectSettings("{ nope");
	expect(r.lsp).toEqual({});
	expect(r.warning).toContain("not valid JSON");
	expect(r.warning).not.toContain("\n");
});

test("wrong shapes warn", () => {
	expect(parseProjectSettings("[]").warning).toContain("must be a JSON object");
	expect(parseProjectSettings("3").warning).toContain("must be a JSON object");
	expect(parseProjectSettings('{"lsp":[]}').warning).toContain('"lsp" must be an object');
	expect(parseProjectSettings('{"lsp":"x"}').lsp).toEqual({});
});
