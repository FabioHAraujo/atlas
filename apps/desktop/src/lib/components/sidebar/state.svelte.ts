/** Sidebar UI state shared by its rows: filter text, expansion, multi-select, delete confirmation. */

import { store } from "#lib/stores/projects.svelte.ts";
import { worktrees } from "#lib/stores/worktrees.svelte.ts";
import { ws, type Worktree } from "#lib/stores/workspace.svelte.ts";
import { childrenOf, matches } from "./model.ts";
import type { ProjectView } from "#lib/api.ts";

class SidebarState {
	filter = $state("");
	showArchived = $state(false);
	hovered = $state<string | null>(null);
	/** ⌘-clicked rows, for bulk delete. */
	multi = $state<Record<string, boolean>>({});
	/** Repos whose worktree list is expanded (other projects are collapsed by default). */
	openRepos = $state<Record<string, boolean>>({});
	deleteIds = $state<string[]>([]);
	deleteForce = $state(false);

	/** Children of a repo, pinned first, unfiltered. */
	kids = (repoId: string) => childrenOf(store.sorted, repoId);

	matches = (p: ProjectView, w: Worktree | undefined) => matches(p, w, this.filter, this.showArchived);

	/** Linked worktrees of a repo that pass the filter; a repo with none shows no children at all. */
	visibleKids = (repoId: string) => this.kids(repoId).filter((p) => this.matches(p, ws.worktree(p.id)));

	repoMatches = (r: ProjectView) => [r, ...this.kids(r.id)].some((p) => this.matches(p, ws.worktree(p.id)));

	askDelete(ids: string[]) {
		this.deleteIds = ids.filter((id) => store.projects.find((p) => p.id === id)?.parent);
		this.deleteForce = false;
	}

	async confirmDelete() {
		const ids = this.deleteIds;
		this.deleteIds = [];
		this.multi = {};
		for (const id of ids) await worktrees.remove(id, this.deleteForce);
	}
}

export const sidebar = new SidebarState();
