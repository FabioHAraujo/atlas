/**
 * Which space a subtree belongs to. Several spaces are mounted at once (the current one and its
 * neighbours, see `SpacePager`), so anything inside a space reads its worktree/project from here
 * instead of the global selection. Outside a pager (no context) it falls back to the selection.
 */
import { getContext, setContext } from "svelte";
import type { ProjectView } from "#lib/api.ts";
import { store } from "#lib/stores/projects.svelte.ts";
import { ws, type Worktree } from "#lib/stores/workspace.svelte.ts";

export interface SpaceCtx {
	/** Repo id of this space (null outside a pager). */
	readonly id: string | null;
	/** This is the active space: it owns focus, drawers and the global selection. */
	readonly current: boolean;
	/** `current` and not mid-gesture: native views (terminal, browser) may show and focus may move in. */
	readonly live: boolean;
	readonly worktree: Worktree | undefined;
	readonly project: ProjectView | null;
}

const KEY = Symbol("atlas.space");

const global: SpaceCtx = {
	id: null,
	get current() {
		return true;
	},
	get live() {
		return true;
	},
	get worktree() {
		return ws.selected;
	},
	get project() {
		return store.current;
	},
};

export const provideSpace = (c: SpaceCtx) => setContext(KEY, c);
export const useSpace = (): SpaceCtx => getContext<SpaceCtx | undefined>(KEY) ?? global;
