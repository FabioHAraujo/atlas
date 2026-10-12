/** Moving the selection around: worktree/tab jumps and the labels the palettes show for them. */
import { store } from "#lib/stores/projects.svelte.ts";
import { ws } from "#lib/stores/workspace.svelte.ts";

export const recentWorktrees = () => ws.doc.recentWorktrees.map((id) => ws.worktree(id)).filter((w) => !!w);

const repoName = (repoId: string) => store.projects.find((p) => p.id === repoId)?.name ?? "";

/** `repo / worktree`, or `repo · main` for a main checkout. */
export function wtLabel(id: string) {
	const w = ws.worktree(id);
	return w ? (w.isMain ? `${w.name} · main` : `${repoName(w.repoId)} / ${w.name}`) : id;
}

export function goWorktree(id: string) {
	ws.view = "worktree";
	store.selected = id;
	ws.select(id);
}

/** Show a tab (optionally in a new split to the right) in its worktree. */
export function goTab(tabId: string, split: boolean) {
	const t = ws.tab(tabId);
	if (!t) return;
	goWorktree(t.worktreeId);
	if (split) ws.split(ws.focusedGroup(t.worktreeId).id, "h", t.id);
	else ws.activate(t.id);
}
