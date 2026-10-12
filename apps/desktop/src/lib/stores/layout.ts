/** Pure split-tree algebra over `Layout`. */

import type { Layout } from "#lib/stores/workspaceTypes.ts";

type Leaf = { type: "leaf"; group: string };

/** Leaf groups of a layout, in visual order. */
export function leaves(l: Layout): string[] {
	return l.type === "leaf" ? [l.group] : [...leaves(l.first), ...leaves(l.second)];
}

/** Rebuild `l` with each leaf replaced by `f(leaf)`; `null` removes it and its sibling takes the parent's place. */
function mapLayout(l: Layout, f: (leaf: Leaf) => Layout | null): Layout | null {
	if (l.type === "leaf") return f(l);
	const a = mapLayout(l.first, f);
	const b = mapLayout(l.second, f);
	if (!a) return b;
	if (!b) return a;
	return { ...l, first: a, second: b };
}

/** `l` with the leaf of `groupId` split in two: the existing group first, `newGroup` second. */
export function splitLeaf(l: Layout, groupId: string, newGroup: string, dir: "h" | "v"): Layout {
	return mapLayout(l, (leaf) =>
		leaf.group === groupId
			? { type: "split", dir, first: leaf, second: { type: "leaf", group: newGroup }, ratio: 0.5 }
			: leaf,
	)!;
}

/** `l` without the leaf of `groupId`; `null` when that was the only leaf. */
export const removeLeaf = (l: Layout, groupId: string): Layout | null =>
	mapLayout(l, (leaf) => (leaf.group === groupId ? null : leaf));

/** Keep a divider between 10% and 90% so neither pane can be dragged shut. */
export const clampRatio = (r: number) => Math.min(0.9, Math.max(0.1, r));

/** The split node at `path` (0 = first, 1 = second at each step), or `null` when it is not a split. */
export function splitAt(l: Layout, path: number[]): Extract<Layout, { type: "split" }> | null {
	let node = l;
	for (const step of path) {
		if (node.type !== "split") return null;
		node = step === 0 ? node.first : node.second;
	}
	return node.type === "split" ? node : null;
}
