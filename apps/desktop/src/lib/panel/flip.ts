/**
 * FLIP for the service grid, only when cards move. Svelte's `animate:` measures every cell of a keyed each on every
 * reconcile (each update of a row's data), a forced layout per update; here a measure happens only when the order of
 * the keys changed.
 */

export interface Box {
	left: number;
	top: number;
}

/** Whether `next` is a different order of keys than `prev` (`null`: first render, nothing to animate from). */
export function orderChanged(prev: string[] | null, next: string[]): boolean {
	return !!prev && (prev.length !== next.length || prev.some((k, i) => k !== next[i]));
}

/** Moves smaller than this are layout rounding, not a card that moved. */
const EPSILON = 0.5;

/** The offset each card that exists before and after must play from (inverse of how far it moved). */
export function flipPlan(
	before: Record<string, Box>,
	after: Record<string, Box>,
): Record<string, { dx: number; dy: number }> {
	const plan: Record<string, { dx: number; dy: number }> = {};
	for (const [k, to] of Object.entries(after)) {
		const from = before[k];
		if (!from) continue;
		const dx = from.left - to.left;
		const dy = from.top - to.top;
		if (Math.abs(dx) > EPSILON || Math.abs(dy) > EPSILON) plan[k] = { dx, dy };
	}
	return plan;
}
