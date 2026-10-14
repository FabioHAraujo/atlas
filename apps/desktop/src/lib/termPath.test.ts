// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { fileTarget } from "./termPath.ts";

const root = "/Users/me/proj";

// ⌘-click on a token in terminal output (compiler error, agent diff header, `git status`).
test("a path:line:col token opens that file at that position", () => {
	expect(fileTarget("src/lib/a.ts:12:3", root, root)).toEqual({ path: "src/lib/a.ts", line: 12, col: 3 });
	expect(fileTarget("./b.rs:7", root, root)).toEqual({ path: "b.rs", line: 7, col: undefined });
	expect(fileTarget("d.tsx(3,4)", root, root)).toEqual({ path: "d.tsx", line: 3, col: 4 });
});

test("a bare path with a file extension opens the file at line 1", () => {
	expect(fileTarget("README.md", root, root)).toEqual({ path: "README.md", line: undefined, col: undefined });
	expect(fileTarget("crates/atlas-term/src/vt/mod.rs", root, root)?.path).toBe(
		"crates/atlas-term/src/vt/mod.rs",
	);
});

// OSC 7 keeps `cwd` current: a relative path is the one the shell is looking at, not the worktree root.
test("relative paths resolve against the terminal's cwd", () => {
	expect(fileTarget("a.ts:1", `${root}/apps/web`, root)?.path).toBe("apps/web/a.ts");
	expect(fileTarget("../api/b.ts:2", `${root}/apps/web`, root)?.path).toBe("apps/api/b.ts");
});

test("absolute paths inside the worktree open; outside it, or escaping it, do not", () => {
	expect(fileTarget(`${root}/src/x.ts:9`, root, root)?.path).toBe("src/x.ts");
	expect(fileTarget("/etc/hosts", root, root)).toBeNull();
	expect(fileTarget("../../secret.txt", root, root)).toBeNull();
	expect(fileTarget(`${root}-other/x.ts:1`, root, root)).toBeNull();
});

test("things that are not file references are ignored", () => {
	for (const t of ["12:34:56", "key:value", "hello", "https://a.dev/x.ts:9", "a.b", "", "~/notes.md"])
		expect(fileTarget(t, root, root), t).toBeNull();
});

test("a missing cwd falls back to the worktree root", () => {
	expect(fileTarget("a.ts:1", null, root)?.path).toBe("a.ts");
});
