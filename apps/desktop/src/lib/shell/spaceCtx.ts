/**
 * Which space a subtree belongs to. Several spaces are mounted at once (the current one and its
 * neighbours, see `SpacePager`), so anything inside a space reads its worktree/project from here
 * instead of the global selection. Outside a pager (no context) it falls back to the selection.
 */
import { store } from "#lib/stores/projects.svelte.ts";
import { ws } from "#lib/stores/workspace.svelte.ts";
import { peekSpace, type SpaceCtx } from "./spaceKey.ts";

export { provideSpace, type SpaceCtx } from "./spaceKey.ts";

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

export const useSpace = (): SpaceCtx => peekSpace() ?? global;
