/**
 * Shell state that is not a dock: spaces (one per repo) and back/forward history over
 * (worktree, tab) visits. Space switches animate through `spacePager` (pager.ts).
 */
import { colorScheme } from "@codeatlasdev/ui";
import { store } from "#lib/stores/projects.svelte.ts";
import { themes } from "#lib/stores/theme.svelte.ts";
import { ws } from "#lib/stores/workspace.svelte.ts";
import { neighbour, accentOf, accentTextOf, hueOf, spreadHues, tintOf } from "#lib/shell/space.ts";
import { spacePager } from "#lib/shell/pager.ts";
import { hueFor } from "#lib/shell/identity.ts";
import { emptyHistory, step, visit, type History, type Visit } from "#lib/shell/history.ts";

class Shell {
	history = $state<History>(emptyHistory());
	/** Entry a back/forward step is landing on; the next recorded visit for it is not new history. */
	#arriving: Visit | null = null;

	/** Repos in sidebar order: the spaces. */
	spaces = $derived(store.sorted.filter((p) => !p.parent));
	spaceIds = $derived(this.spaces.map((s) => s.id));
	/** Spread derived hues, overridden by the user's color choice (`ProjectView.identity.hue`). */
	hues = $derived.by(() => {
		const spread = spreadHues(this.spaceIds);
		return Object.fromEntries(this.spaces.map((s) => [s.id, hueFor(s.id, s.identity, spread[s.id])]));
	});

	/** Repo id of the selected worktree (the active space). */
	activeId = $derived.by(() => {
		const cur = store.current;
		return cur ? (cur.parent ?? cur.id) : null;
	});
	active = $derived(this.spaces.find((s) => s.id === this.activeId) ?? null);

	get dark() {
		return colorScheme.resolved === "dark";
	}

	accent(spaceId: string) {
		return accentOf(spaceId, this.dark, this.hues[spaceId]);
	}
	/** The accent as text: AA on every chrome surface of the live theme (`accentTextOf`). `--space-accent` is for fills. */
	accentText(spaceId: string) {
		const st = themes.current?.style;
		const surfaces = [
			"background",
			"editor.background",
			"surface.background",
			"elevated_surface.background",
		].map((k) => (st?.[k] as string | undefined)?.slice(0, 7) ?? (this.dark ? "#000000" : "#ffffff"));
		return accentTextOf(this.dark, this.hues[spaceId] ?? hueOf(spaceId), surfaces);
	}
	tint(spaceId: string) {
		return tintOf(spaceId, this.dark, this.hues[spaceId]);
	}

	/** Worktree to land on when entering a space: the one last used there, else its main checkout. */
	landing(spaceId: string): string {
		const kids = new Set([spaceId, ...store.projects.filter((p) => p.parent === spaceId).map((p) => p.id)]);
		const last = ws.doc.recentWorktrees.find((id) => kids.has(id) && ws.worktree(id));
		return last ?? spaceId;
	}

	/** Switch to a space: the selection moves now, the pager animates the layers into place. */
	switchTo(spaceId: string) {
		if (spaceId === this.activeId) {
			ws.view = "worktree";
			return;
		}
		if (!spacePager.go(spaceId)) this.commitSpace(spaceId);
	}

	/** The state half of a space switch (what the pager calls once it has decided): enter the space. */
	commitSpace(spaceId: string) {
		if (spaceId !== this.activeId || ws.view !== "worktree") this.select(this.landing(spaceId));
	}

	/** Previous / next space, wrapping. */
	cycleSpace(delta: 1 | -1) {
		const to = neighbour(this.spaceIds, this.activeId, delta);
		if (to) this.switchTo(to);
	}

	/** Space `n` (1-based) of the sidebar. */
	spaceAt(n: number) {
		const s = this.spaces[n - 1];
		if (s) this.switchTo(s.id);
	}

	select(worktreeId: string) {
		ws.view = "worktree";
		store.selected = worktreeId;
		ws.select(worktreeId);
	}

	/** Record where the user is now. The arrival of a back/forward step is not a new visit. */
	note(v: Visit) {
		const target = this.#arriving;
		if (target) {
			this.#arriving = null;
			if (target.worktreeId === v.worktreeId) return;
		}
		this.history = visit(this.history, v);
	}

	#alive = (v: Visit) => !!ws.worktree(v.worktreeId) && (!v.tabId || !!ws.tab(v.tabId));

	canGo(delta: 1 | -1) {
		return step(this.history, delta, this.#alive) !== null;
	}

	/** ⌘[ / ⌘]: move through visited (worktree, tab) pairs, skipping the ones that no longer exist. */
	/** Where Back / Forward would land, for the arrow tooltips. */
	target(delta: 1 | -1): Visit | null {
		return step(this.history, delta, this.#alive)?.to ?? null;
	}

	go(delta: 1 | -1) {
		const r = step(this.history, delta, this.#alive);
		if (!r) return;
		// `history.at` already points at the target, so the visit the layout effect records next is a no-op.
		this.history = r.history;
		const tabNow = ws.selected ? ws.focusedGroup(ws.selected.id).activeTab : null;
		const unchanged = ws.selected?.id === r.to.worktreeId && (!r.to.tabId || r.to.tabId === tabNow);
		this.#arriving = unchanged ? null : r.to;
		const fromSpace = this.activeId;
		const w = ws.worktree(r.to.worktreeId);
		// Across spaces: the pager slides the layers; the exact (worktree, tab) target is selected below.
		const slide = w && w.repoId !== fromSpace ? w.repoId : null;
		this.select(r.to.worktreeId);
		if (slide && fromSpace) spacePager.go(slide, fromSpace);
		if (r.to.tabId && ws.tab(r.to.tabId)) ws.activate(r.to.tabId);
	}
}

export const shell = new Shell();
