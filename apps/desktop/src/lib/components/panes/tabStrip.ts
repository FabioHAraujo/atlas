interface Span {
	left: number;
	right: number;
}

/**
 * New `scrollLeft` for a tab strip so `tab` is fully visible (viewport coordinates, as `getBoundingClientRect` gives).
 * A hidden tab scrolls just far enough, with `margin`; a visible one leaves the strip alone; a tab wider than the
 * viewport aligns its left edge. Never negative.
 */
export function scrollTabIntoView(a: {
	scroller: Span;
	tab: Span;
	scrollLeft: number;
	margin: number;
}): number {
	const { scroller, tab, scrollLeft, margin } = a;
	const over = tab.left - margin - scroller.left;
	const under = tab.right + margin - scroller.right;
	// Hidden on the right: reveal the right edge, but never push the tab's own left edge out of view (a wide tab).
	const delta = over < 0 ? over : under > 0 ? Math.min(under, over) : 0;
	return Math.max(0, scrollLeft + delta);
}
