// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { childrenOf, matches, strongest } from "./model.ts";

const p = (id: string, over: Record<string, unknown> = {}) => ({
	id,
	name: id,
	root: `/r/${id}`,
	branch: null,
	parent: null,
	pinned: false,
	...over,
});

test("childrenOf keeps only the repo's worktrees, pinned first", () => {
	const rows = [
		p("a"),
		p("b", { parent: "a" }),
		p("c", { parent: "a", pinned: true }),
		p("d", { parent: "z" }),
	];
	expect(childrenOf(rows, "a").map((r) => r.id)).toEqual(["c", "b"]);
});

test("matches hides archived rows unless shown, and filters on name/branch/worktree/root", () => {
	const row = p("api", { branch: "feat/x" });
	expect(matches(row, { name: "w", archived: true }, "", false)).toBe(false);
	expect(matches(row, { name: "w", archived: true }, "", true)).toBe(true);
	expect(matches(row, undefined, "  FEAT ", false)).toBe(true);
	expect(matches(row, { name: "scratch", archived: false }, "scr", false)).toBe(true);
	expect(matches(row, undefined, "/r/api", false)).toBe(true);
	expect(matches(row, undefined, "nope", false)).toBe(false);
});

test("strongest picks blocked over waiting over working over done over idle", () => {
	expect(strongest([])).toBeNull();
	expect(strongest(["idle", "done"])).toBe("done");
	expect(strongest(["working", "waiting", "idle"])).toBe("waiting");
	expect(strongest(["done", "blocked"])).toBe("blocked");
});
