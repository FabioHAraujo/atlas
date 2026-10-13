/**
 * What makes a page's native snapshot stale, and when the native side needs to hear about the pages again. Pure.
 *
 * A selection flips roles on the layer roots (`class`, `inert`, `data-role`, `aria-hidden`, the parked `style`):
 * that is not a change of what the page shows, so it must not trigger a re-snapshot (a snapshot costs main-thread
 * time; re-taking three per selection was a measured 40-60 ms stall).
 */

export interface MutationFacts {
	type: "attributes" | "childList" | "characterData";
	attributeName: string | null;
	/** The mutation target is the `.space-layer` element itself. */
	targetIsLayerRoot: boolean;
	/** The page (space id) the target sits in; null outside any layer. */
	page: string | null;
}

/** Attributes the pager itself writes on a layer root while moving/parking it. */
const ROLE_ATTRS = new Set(["class", "inert", "data-role", "data-side", "aria-hidden", "style"]);

/** The page whose snapshot this mutation made stale, or null when it changed nothing a snapshot shows. */
export function dirtyPage(m: MutationFacts): string | null {
	if (!m.page) return null;
	if (m.type === "attributes" && m.targetIsLayerRoot && m.attributeName && ROLE_ATTRS.has(m.attributeName))
		return null;
	return m.page;
}

export interface PagesState {
	order: string[];
	rect: number[];
	active?: string | null;
}

/** Native needs the order and the pager rect to place layers; the active page does not change either. */
export function pagesChanged(prev: PagesState | null, next: PagesState): boolean {
	if (!prev) return true;
	return (
		prev.order.length !== next.order.length ||
		prev.order.some((id, i) => id !== next.order[i]) ||
		prev.rect.some((v, i) => v !== next.rect[i])
	);
}
