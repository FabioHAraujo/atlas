// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { flattenSymbols } from "./symbols.svelte.ts";

const view = (doc: string) => ({ state: EditorState.create({ doc }) });
const r = (l: number, c: number) => ({
	start: { line: l, character: c },
	end: { line: l, character: c + 1 },
});

test("hierarchical symbols flatten with their container; local variables are dropped", () => {
	const v = view("struct A {\n  fn go() {\n    let x = 1;\n  }\n}\n");
	const out = flattenSymbols(v, [
		{
			name: "A",
			kind: 23,
			range: r(0, 0),
			selectionRange: r(0, 7),
			children: [
				{
					name: "go",
					kind: 6,
					range: r(1, 0),
					selectionRange: r(1, 5),
					children: [{ name: "x", kind: 13, range: r(2, 0), selectionRange: r(2, 8) }],
				},
			],
		},
	]);
	expect(out.map((s) => [s.name, s.kind, s.container, s.line])).toEqual([
		["A", "Struct", undefined, 1],
		["go", "Method", "A", 2],
	]);
});

test("flat SymbolInformation keeps containerName", () => {
	const v = view("a\nb\n");
	const out = flattenSymbols(v, [
		{ name: "b", kind: 12, containerName: "mod", location: { range: r(1, 0) } },
	]);
	expect(out).toEqual([{ name: "b", kind: "Function", from: 2, line: 2, container: "mod" }]);
});
