// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { ancestorsOf, join, navMove, parentOf, statusMap, visibleRows } from "./tree.ts";

const e = (name, kind = "file") => ({ name, kind, size: 0, mtime: 0 });

test("visible rows descend only into expanded, loaded folders", () => {
	const children = { "": [e("src", "dir"), e("a.md")], src: [e("x.ts")], lib: [e("y.ts")] };
	expect(visibleRows(children, {}).map((r) => r.rel)).toEqual(["src", "a.md"]);
	expect(visibleRows(children, { src: true }).map((r) => r.rel)).toEqual(["src", "src/x.ts", "a.md"]);
	expect(visibleRows({ "": [e("src", "dir")] }, { src: true }).map((r) => r.rel)).toEqual(["src"]);
});

test("ancestors run outermost first and are empty at the root", () => {
	expect(ancestorsOf("a/b/c.ts")).toEqual(["a", "a/b"]);
	expect(ancestorsOf("c.ts")).toEqual([]);
});

test("join and parentOf treat the root as the empty path", () => {
	expect(join("", "a.ts")).toBe("a.ts");
	expect(join("src", "a.ts")).toBe("src/a.ts");
	expect(parentOf("src/lib/a.ts")).toBe("src/lib");
	expect(parentOf("a.ts")).toBe("");
});

test("statusMap classifies entries and marks the folders above a change", () => {
	const m = statusMap([
		{ path: "src/lib/a.ts", x: " ", y: "M" },
		{ path: "src/new.ts", x: "?", y: "?" },
		{ path: "src/gone.ts", x: " ", y: "D" },
	]);
	expect(m["src/lib/a.ts"]).toBe("modified");
	expect(m["src/new.ts"]).toBe("untracked");
	expect(m["src/gone.ts"]).toBe("deleted");
	expect(m["src"]).toBe("modified");
	expect(m["src/lib"]).toBe("modified");
});

test("navMove walks rows, folds folders and ignores other keys", () => {
	const children = { "": [e("src", "dir"), e("a.md")], src: [e("x.ts")] };
	const closed = visibleRows(children, {});
	const open = visibleRows(children, { src: true });
	expect(navMove("ArrowDown", closed, "src", {})).toEqual({ focus: "a.md" });
	expect(navMove("ArrowDown", closed, "a.md", {})).toEqual({ focus: "a.md" });
	expect(navMove("ArrowUp", closed, "src", {})).toEqual({ focus: "src" });
	expect(navMove("End", closed, "src", {})).toEqual({ focus: "a.md" });
	expect(navMove("ArrowRight", closed, "src", {})).toEqual({ toggle: "src" });
	expect(navMove("ArrowRight", open, "src", { src: true })).toEqual({ focus: "src/x.ts" });
	expect(navMove("ArrowLeft", open, "src", { src: true })).toEqual({ toggle: "src" });
	expect(navMove("ArrowLeft", open, "src/x.ts", { src: true })).toEqual({ focus: "src" });
	expect(navMove("ArrowLeft", closed, "a.md", {})).toEqual({ focus: undefined });
	expect(navMove("Enter", closed, "a.md", {})).toEqual({ open: { rel: "a.md", dir: false } });
	expect(navMove("F2", closed, "a.md", {})).toEqual({ rename: "a.md" });
	expect(navMove("x", closed, "a.md", {})).toBeNull();
});
