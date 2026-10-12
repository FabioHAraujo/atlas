/** Pure font-list helpers for the GPU terminal: CSS `font-family` list → installed-family candidates. */

/** Generic CSS keywords: they name no installed family, so the native renderer cannot resolve them. */
const GENERIC: Record<string, true> = {
	monospace: true,
	"ui-monospace": true,
	"system-ui": true,
	"sans-serif": true,
	serif: true,
};

/** Family names of a CSS list, in order: split on commas outside quotes, unquoted, generics dropped. */
export function fontCandidates(css: string): string[] {
	const parts: string[] = [];
	let cur = "";
	let quote: string | null = null;
	for (const ch of css) {
		if (quote) {
			if (ch === quote) quote = null;
			else cur += ch;
		} else if (ch === '"' || ch === "'") quote = ch;
		else if (ch === ",") {
			parts.push(cur);
			cur = "";
		} else cur += ch;
	}
	parts.push(cur);
	return parts.map((p) => p.trim()).filter((p) => p && !GENERIC[p.toLowerCase()]);
}

/** Cell rect of a padded terminal: the slot shrunk by `px`/`py` on each side, never below 1 × 1. */
export function insetRect(
	r: { left: number; top: number; width: number; height: number },
	px: number,
	py: number,
) {
	return {
		x: r.left + px,
		y: r.top + py,
		w: Math.max(1, r.width - 2 * px),
		h: Math.max(1, r.height - 2 * py),
	};
}
