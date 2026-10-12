/** Pure sidebar rules: which worktrees pass the filter, child ordering, strongest agent state. */

import type { AgentState } from "#lib/stores/agents.svelte.ts";

/** What the rules need to know about a project row. */
interface Row {
	id: string;
	name: string;
	root: string;
	branch?: string | null;
	parent?: string | null;
	pinned: boolean;
}

/** Worktree facts the filter looks at. */
interface Wt {
	name: string;
	archived: boolean;
}

/** Linked worktrees of `repoId`, pinned first (stable otherwise). `sorted` is the store's order. */
export function childrenOf<P extends Row>(sorted: P[], repoId: string): P[] {
	return sorted.filter((p) => p.parent === repoId).sort((a, b) => Number(b.pinned) - Number(a.pinned));
}

/** Does the row survive the filter text and the "show archived" toggle? */
export function matches(p: Row, w: Wt | undefined, filter: string, showArchived: boolean): boolean {
	if (w?.archived && !showArchived) return false;
	const q = filter.trim().toLowerCase();
	return !q || [p.name, p.branch ?? "", w?.name ?? "", p.root].some((x) => x.toLowerCase().includes(q));
}

const GLYPH_ORDER: AgentState[] = ["blocked", "waiting", "working", "done", "idle"];

/** Strongest agent state among a set of states, or null when there are none. */
export function strongest(states: AgentState[]): AgentState | null {
	return GLYPH_ORDER.find((s) => states.includes(s)) ?? null;
}
