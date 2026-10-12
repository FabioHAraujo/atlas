/** Pure helpers for the HTML live preview (see `preview.svelte.ts`). */

import { leaves } from "#lib/stores/layout.ts";
import type { Layout } from "#lib/stores/workspaceTypes.ts";

/** Files the editor offers "Open preview" for. */
export const isHtml = (path: string | undefined) => !!path && /\.html?$/i.test(path);

/** `host:port` of an http(s) URL, or `null`. */
export function originOf(url: string | undefined): string | null {
	try {
		const u = new URL(url ?? "");
		return /^https?:$/.test(u.protocol) ? u.host : null;
	} catch {
		return null;
	}
}

/**
 * Group the preview goes into: the group to the right of `from` in the visual order when
 * the layout already has one (so repeated previews don't keep splitting), else `null`
 * (the caller splits `from` to the right).
 */
export function rightNeighbor(
	layout: Layout,
	from: string,
	skip: (groupId: string) => boolean,
): string | null {
	const order = leaves(layout);
	const i = order.indexOf(from);
	if (i < 0) return null;
	return order.slice(i + 1).find((g) => !skip(g)) ?? null;
}
