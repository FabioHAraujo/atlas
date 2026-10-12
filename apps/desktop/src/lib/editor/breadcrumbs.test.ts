// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { breadcrumbPath, nestFlat, pathSegments, symbolChain, type Sym } from "./breadcrumbs.ts";

const tree: Sym[] = [
	{
		name: "Foo",
		kind: "Class",
		from: 0,
		to: 100,
		children: [
			{
				name: "bar",
				kind: "Method",
				from: 10,
				to: 50,
				children: [{ name: "inner", kind: "Function", from: 20, to: 30 }],
			},
			{ name: "baz", kind: "Method", from: 50, to: 90 },
		],
	},
	{ name: "main", kind: "Function", from: 100, to: 200 },
];

test("symbolChain picks the deepest containing chain", () => {
	expect(symbolChain(tree, 25).map((s) => s.name)).toEqual(["Foo", "bar", "inner"]);
	expect(symbolChain(tree, 12).map((s) => s.name)).toEqual(["Foo", "bar"]);
	expect(symbolChain(tree, 60).map((s) => s.name)).toEqual(["Foo", "baz"]);
	expect(symbolChain(tree, 150).map((s) => s.name)).toEqual(["main"]);
});

test("boundaries: from is inclusive, to is exclusive", () => {
	expect(symbolChain(tree, 0).map((s) => s.name)).toEqual(["Foo"]);
	expect(symbolChain(tree, 10).map((s) => s.name)).toEqual(["Foo", "bar"]);
	expect(symbolChain(tree, 50).map((s) => s.name)).toEqual(["Foo", "baz"]); // bar ends at 50
	expect(symbolChain(tree, 100).map((s) => s.name)).toEqual(["main"]); // Foo ends at 100
	expect(symbolChain(tree, 200)).toEqual([]);
});

test("outside every symbol, empty tree, gaps between symbols", () => {
	expect(symbolChain(tree, 500)).toEqual([]);
	expect(symbolChain([], 5)).toEqual([]);
	expect(symbolChain(tree, 95).map((s) => s.name)).toEqual(["Foo"]); // inside Foo, between children
});

test("overlapping siblings choose the narrowest", () => {
	const odd: Sym[] = [
		{ name: "wide", kind: "Function", from: 0, to: 100 },
		{ name: "narrow", kind: "Function", from: 10, to: 20 },
	];
	expect(symbolChain(odd, 15).map((s) => s.name)).toEqual(["narrow"]);
});

test("breadcrumbPath returns symbol segments with kind and jump offset", () => {
	expect(breadcrumbPath(tree, 25)).toEqual([
		{ kind: "symbol", name: "Foo", symbolKind: "Class", from: 0 },
		{ kind: "symbol", name: "bar", symbolKind: "Method", from: 10 },
		{ kind: "symbol", name: "inner", symbolKind: "Function", from: 20 },
	]);
	expect(breadcrumbPath([], 0)).toEqual([]);
});

test("pathSegments: dirs then file, with cumulative paths", () => {
	expect(pathSegments("src/lib/editor/a.ts")).toEqual([
		{ kind: "dir", name: "src", path: "src" },
		{ kind: "dir", name: "lib", path: "src/lib" },
		{ kind: "dir", name: "editor", path: "src/lib/editor" },
		{ kind: "file", name: "a.ts", path: "src/lib/editor/a.ts" },
	]);
	expect(pathSegments("README.md")).toEqual([{ kind: "file", name: "README.md", path: "README.md" }]);
	expect(pathSegments("./a//b.ts")).toEqual([
		{ kind: "dir", name: "a", path: "a" },
		{ kind: "file", name: "b.ts", path: "a/b.ts" },
	]);
	expect(pathSegments("")).toEqual([]);
});

test("nestFlat: one level, each symbol ends where the next starts", () => {
	const nested = nestFlat(
		[
			{ name: "a", kind: "Function", from: 0 },
			{ name: "b", kind: "Class", from: 40 },
			{ name: "c", kind: "Function", from: 80 },
		],
		120,
	);
	expect(nested.map((s) => [s.name, s.from, s.to])).toEqual([
		["a", 0, 40],
		["b", 40, 80],
		["c", 80, 120],
	]);
});

test("nestFlat: markdown headings nest by depth", () => {
	const nested = nestFlat(
		[
			{ name: "Title", kind: "H1", from: 0 },
			{ name: "One", kind: "H2", from: 10 },
			{ name: "Deep", kind: "H3", from: 20 },
			{ name: "Two", kind: "H2", from: 30 },
			{ name: "Other", kind: "H1", from: 50 },
		],
		70,
	);
	expect(nested).toHaveLength(2);
	const [title, other] = nested;
	expect([title.from, title.to]).toEqual([0, 50]);
	expect(title.children.map((c) => [c.name, c.from, c.to])).toEqual([
		["One", 10, 30],
		["Two", 30, 50],
	]);
	expect(title.children[0].children.map((c) => [c.name, c.to])).toEqual([["Deep", 30]]);
	expect([other.from, other.to]).toEqual([50, 70]);
	expect(symbolChain(nested, 25).map((s) => s.name)).toEqual(["Title", "One", "Deep"]);
	expect(symbolChain(nested, 35).map((s) => s.name)).toEqual(["Title", "Two"]);
});

test("nestFlat: a heading that skips a level still nests under the previous", () => {
	const nested = nestFlat(
		[
			{ name: "A", kind: "H1", from: 0 },
			{ name: "C", kind: "H3", from: 10 },
		],
		20,
	);
	expect(nested[0].children.map((c) => c.name)).toEqual(["C"]);
});

test("nestFlat: custom levelOf and empty input", () => {
	const nested = nestFlat(
		[
			{ name: "Cls", kind: "Class", from: 0 },
			{ name: "m", kind: "Method", from: 10 },
		],
		30,
		(s) => (s.kind === "Class" ? 0 : 1),
	);
	expect(nested[0].children[0]).toMatchObject({ name: "m", from: 10, to: 30 });
	expect(nested[0].to).toBe(30);
	expect(nestFlat([], 10)).toEqual([]);
});

import { lspTree } from "./breadcrumbs.ts";

test("an LSP DocumentSymbol tree becomes offsets, drops locals inside scopes and keeps top-level consts", () => {
	const at = (p: { line: number; character: number }) => p.line * 100 + p.character;
	const r = (l1: number, l2: number) => ({
		start: { line: l1, character: 0 },
		end: { line: l2, character: 0 },
	});
	const tree = lspTree(
		[
			{ name: "LIMIT", kind: 14, range: r(0, 0), selectionRange: r(0, 0) },
			{
				name: "Server",
				kind: 5,
				range: r(2, 20),
				selectionRange: r(2, 2),
				children: [
					{
						name: "start",
						kind: 6,
						range: r(4, 10),
						selectionRange: r(4, 4),
						children: [{ name: "port", kind: 13, range: r(5, 5), selectionRange: r(5, 5) }],
					},
				],
			},
		],
		at,
	);
	expect(tree.map((s) => s.name)).toEqual(["LIMIT", "Server"]);
	expect(tree[1].kind).toBe("Class");
	expect(tree[1].children?.map((c) => [c.name, c.kind, c.from, c.to])).toEqual([
		["start", "Method", 400, 1000],
	]);
	expect(tree[1].children?.[0].children).toBeUndefined();
	expect(symbolChain(tree, 600).map((s) => s.name)).toEqual(["Server", "start"]);
});
