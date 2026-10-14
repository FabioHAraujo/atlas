/**
 * The bottom-right corner of the window holds transient pieces (the Getting started card, the omp prompt, the
 * Ghostty offer, "Updated to…", error toasts, the action-result chip). They used to be independent `position: fixed`
 * boxes with hard-coded offsets and overlapped. They are now children of ONE fixed flex column (`#atlas-corner`,
 * `CornerStack.svelte`), nearest-the-corner first; `layoutCorner` is the same placement as numbers, which the tests
 * and the live overlap probe check against.
 */

/** Distance of the stack from the window's right and bottom edges. */
export const CORNER_MARGIN = 16;
/** Space between two stacked pieces. */
export const CORNER_GAP = 10;

export interface CornerPiece {
	id: string;
	height: number;
}

export interface PlacedPiece extends CornerPiece {
	/** Distance from the window's bottom edge to the piece's bottom edge. */
	bottom: number;
}

/** Stacks pieces upward from the corner in the given order; a piece with no (or an invalid) height takes no room. */
export function layoutCorner(pieces: CornerPiece[]): PlacedPiece[] {
	let bottom = CORNER_MARGIN;
	const out: PlacedPiece[] = [];
	for (const p of pieces) {
		if (!(p.height > 0)) continue;
		out.push({ id: p.id, height: p.height, bottom });
		bottom += p.height + CORNER_GAP;
	}
	return out;
}

/** Id of the container every corner piece mounts into. */
export const CORNER_ID = "atlas-corner";

/**
 * Svelte action: moves the node into the corner column (the node keeps its component, reactivity and transitions;
 * only its DOM parent changes) and out again on destroy. Without a corner (tests, the tray page) it stays in place.
 */
export function corner(node: HTMLElement) {
	const host = document.getElementById(CORNER_ID);
	if (!host) return;
	host.append(node);
	return { destroy: () => node.remove() };
}
