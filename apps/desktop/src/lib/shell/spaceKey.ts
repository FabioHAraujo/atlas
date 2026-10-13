/**
 * The space context's key and shape, with no store imports: a component that only needs to know whether its layer is
 * the current one (`Overlay`) must not drag the whole store graph (and the UI kit) in with it. `spaceCtx.ts` adds the
 * store-backed fallback `useSpace()` for everything else.
 */
import { getContext, setContext } from "svelte";
import type { ProjectView } from "#lib/api.ts";
import type { Worktree } from "#lib/stores/workspace.svelte.ts";

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

export const provideSpace = (c: SpaceCtx) => setContext(KEY, c);
/** The enclosing space, or undefined outside a pager. */
export const peekSpace = () => getContext<SpaceCtx | undefined>(KEY);
