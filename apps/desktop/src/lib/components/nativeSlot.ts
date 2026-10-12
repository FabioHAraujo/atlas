/**
 * Re-measure a native child view (terminal, browser) whenever its DOM slot may have moved:
 * the slot resizes, the window resizes, or a dialog/palette opens or closes (the native view must
 * be parked under those). Returns the teardown.
 */
export function watchSlot(slot: Element, sync: () => void): () => void {
	const ro = new ResizeObserver(sync);
	ro.observe(slot);
	const mo = new MutationObserver(sync);
	mo.observe(document.body, {
		subtree: true,
		attributes: true,
		attributeFilter: ["data-state"],
		childList: true,
	});
	window.addEventListener("resize", sync);
	return () => {
		ro.disconnect();
		mo.disconnect();
		window.removeEventListener("resize", sync);
	};
}

/** Dialogs and the palette must sit above the native view: park it while one is open. */
export const overlayOpen = () => !!document.querySelector("[role=dialog][data-state=open]");
