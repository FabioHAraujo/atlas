/** The `pty_create` request for a terminal tab: same env, scope and mode for a new tab and a Restart. */

import type { host } from "#lib/host.ts";

type CreateArgs = Parameters<typeof host.ptyCreate>[0];

export function ptyRequest(tab: {
	id: string;
	worktreeId: string;
	cwd: string;
	argv?: string[];
	env?: Record<string, string>;
	chat?: boolean;
}): CreateArgs {
	return {
		cwd: tab.cwd,
		argv: tab.argv ?? [],
		env: { ATLAS_TAB_ID: tab.id, ATLAS_WORKTREE_ID: tab.worktreeId, ...(tab.env ?? {}) },
		scope: { worktree_id: tab.worktreeId, tab_id: tab.id, pane_key: tab.id },
		mode: tab.chat ? "pipe" : "pty",
	};
}
