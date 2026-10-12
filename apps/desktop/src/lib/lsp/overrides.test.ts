// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { cleanOverride, deepMerge, mergeLspOverrides } from "./overrides.ts";

test("nothing set means no override", () => {
	expect(mergeLspOverrides(undefined, undefined, "go")).toBeUndefined();
	expect(mergeLspOverrides({ rust: { command: "ra" } }, {}, "go")).toBeUndefined();
});

test("user only, project only", () => {
	expect(mergeLspOverrides({ go: { command: "gopls-dev" } }, undefined, "go")).toEqual({
		command: "gopls-dev",
	});
	expect(mergeLspOverrides(undefined, { go: { disabled: true } }, "go")).toEqual({ disabled: true });
});

test("project wins per field, user fields it does not set survive", () => {
	const m = mergeLspOverrides(
		{ go: { command: "a", args: ["-x"], disabled: false } },
		{ go: { command: "b" } },
		"go",
	);
	expect(m).toEqual({ command: "b", args: ["-x"], disabled: false });
});

test("initialization_options and settings merge deeply, arrays are replaced", () => {
	const m = mergeLspOverrides(
		{ typescript: { settings: { ts: { a: 1, b: [1, 2] }, x: 1 } } },
		{ typescript: { settings: { ts: { b: [3] }, y: 2 } } },
		"typescript",
	);
	expect(m.settings).toEqual({ ts: { a: 1, b: [3] }, x: 1, y: 2 });
});

test("project can re-enable a language the user disabled", () => {
	expect(mergeLspOverrides({ go: { disabled: true } }, { go: { disabled: false } }, "go").disabled).toBe(
		false,
	);
});

test("bad shapes are dropped, never thrown", () => {
	expect(cleanOverride(null)).toEqual({});
	expect(cleanOverride("x")).toEqual({});
	expect(cleanOverride([])).toEqual({});
	expect(
		cleanOverride({ command: 3, args: ["a", 2], initialization_options: [], settings: "s", disabled: "yes" }),
	).toEqual({});
	expect(cleanOverride({ command: "  ls  " })).toEqual({ command: "ls" });
	expect(cleanOverride({ command: "   " })).toEqual({});
});

test("deepMerge does not mutate its inputs", () => {
	const a = { k: { x: 1 } };
	const b = { k: { y: 2 } };
	expect(deepMerge(a, b)).toEqual({ k: { x: 1, y: 2 } });
	expect(a).toEqual({ k: { x: 1 } });
});
