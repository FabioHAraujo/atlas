// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { StreamLanguage } from "@codemirror/language";
import { highlightCode } from "@lezer/highlight";
import { fileType } from "./fileType.ts";
import { rememberRich, richByDefault, wantsRich } from "./richPref.ts";
import { envMode, gitignoreMode, justfileMode, logMode, makefileMode, procfileMode } from "./modes.ts";

const mem = () => {
	const m = new Map();
	return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

test("rich view defaults per type, and the choice is remembered per type, not per file", () => {
	const s = mem();
	const dockerfile = fileType("a/Dockerfile");
	const tsconfig = fileType("tsconfig.json");
	expect(richByDefault(dockerfile)).toBe(true);
	expect(richByDefault(tsconfig)).toBe(false);
	expect(wantsRich(dockerfile, s)).toBe(true);
	expect(wantsRich(tsconfig, s)).toBe(false);
	rememberRich(dockerfile, false, s);
	rememberRich(tsconfig, true, s);
	expect(wantsRich(fileType("other/Dockerfile.dev"), s)).toBe(false);
	expect(wantsRich(fileType("x/tsconfig.json"), s)).toBe(true);
	expect(wantsRich(fileType(".env"), s)).toBe(true);
});

test("types without a rich view never want one; corrupt storage falls back to defaults", () => {
	expect(wantsRich(fileType("main.rs"), mem())).toBe(false);
	const bad = { getItem: () => "{not json", setItem() {} };
	expect(wantsRich(fileType(".env"), bad)).toBe(true);
});

/** Token classes a stream mode emits for each line, to pin its behaviour. */
function tokens(mode, text) {
	const lang = StreamLanguage.define(mode);
	const out = [];
	highlightCode(
		text,
		lang.parser.parse(text),
		{ style: (tags) => (tags.length ? tags.map((t) => t.toString()).join("+") : null) },
		(t, c) => c && out.push([t, c]),
		() => {},
	);
	return out;
}

test("env mode: keys, operators, quoted multi-line values, comments, expansions", () => {
	const t = tokens(envMode, '# c\nexport A=1\nB="x\ny"\nC=${A}/z');
	const find = (s) => t.find(([x]) => x === s)?.[1];
	expect(find("# c")).toContain("comment");
	expect(find("A")).toContain("propertyName");
	expect(find("${A}")).toContain("variableName");
	expect(t.some(([x, c]) => x.includes("y") && c.includes("string"))).toBe(true);
});

test("makefile mode: targets, variables, directives; recipes are not mistaken for targets", () => {
	const t = tokens(makefileMode, "CC := gcc\nbuild: dep\n\techo a: b\n.PHONY: build\n");
	expect(t.find(([x]) => x === "CC")?.[1]).toContain("variableName");
	expect(t.find(([x]) => x === "build")?.[1]).toContain("labelName");
	expect(t.some(([x, c]) => x.startsWith("a") && c.includes("labelName"))).toBe(false);
});

test("justfile, procfile, gitignore and log modes tokenise their keywords", () => {
	expect(
		tokens(justfileMode, "set shell := []\nbuild:\n    echo\n").some(([, c]) => c.includes("labelName")),
	).toBe(true);
	expect(tokens(procfileMode, "web: bun start\n").find(([x]) => x === "web")?.[1]).toContain("labelName");
	expect(
		tokens(gitignoreMode, "!keep\n*.log\n# c\n").some(([x, c]) => x === "!" && c.includes("keyword")),
	).toBe(true);
	expect(
		tokens(logMode, "2024-01-02 10:00:00 ERROR boom\n").some(
			([x, c]) => x === "ERROR" && c.includes("invalid"),
		),
	).toBe(true);
});
