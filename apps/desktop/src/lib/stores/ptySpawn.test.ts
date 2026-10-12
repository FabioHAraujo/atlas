// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { ptyRequest } from "./ptySpawn.ts";

test("ptyRequest tags the pty with its tab and worktree, caller env wins", () => {
	const r = ptyRequest({
		id: "t",
		worktreeId: "w",
		cwd: "/x",
		argv: ["zsh"],
		env: { ATLAS_TAB_ID: "own", A: "1" },
	});
	expect(r).toEqual({
		cwd: "/x",
		argv: ["zsh"],
		env: { ATLAS_TAB_ID: "own", ATLAS_WORKTREE_ID: "w", A: "1" },
		scope: { worktree_id: "w", tab_id: "t", pane_key: "t" },
		mode: "pty",
	});
});

test("ptyRequest uses pipe mode for chat tabs and defaults argv", () => {
	const r = ptyRequest({ id: "t", worktreeId: "w", cwd: "/x", chat: true });
	expect(r.mode).toBe("pipe");
	expect(r.argv).toEqual([]);
});
