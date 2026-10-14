/** Who a pointer event belongs to when the program in the terminal may want the mouse. Pure. */

/** Most wheel notches reported for one scroll event (a trackpad fling is hundreds of lines). */
const MAX_NOTCHES = 20;

/**
 * `program`: the app running in the terminal asked for mouse reports (vim, tmux, an agent TUI) and gets this
 * event. `terminal`: Atlas handles it (selection, links). ⌘ is the app's gesture (links, paths) and ⇧ gives
 * the selection back to the terminal, as Ghostty's `mouse-shift-capture = false`.
 */
export function mouseRoute(
	programOwnsMouse: boolean,
	e: { shiftKey: boolean; metaKey: boolean },
): "program" | "terminal" {
	return programOwnsMouse && !e.shiftKey && !e.metaKey ? "program" : "terminal";
}

/** Scroll lines (positive = up) → the wheel report to send and how many times; `null` = no movement. */
export function wheelReports(lines: number): { action: "wheelUp" | "wheelDown"; count: number } | null {
	if (!lines) return null;
	return { action: lines > 0 ? "wheelUp" : "wheelDown", count: Math.min(Math.abs(lines), MAX_NOTCHES) };
}
