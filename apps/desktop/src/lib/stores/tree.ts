import type { FsEntry } from "#lib/host.ts";

interface TreeRow {
	rel: string;
	dir: boolean;
}

/** Visible rows in display order (folders descend only when expanded and loaded). */
export function visibleRows(
	children: Record<string, FsEntry[]>,
	expanded: Record<string, boolean>,
): TreeRow[] {
	const out: TreeRow[] = [];
	const walk = (dir: string) => {
		for (const e of children[dir] ?? []) {
			const rel = dir ? `${dir}/${e.name}` : e.name;
			const isDir = e.kind === "dir";
			out.push({ rel, dir: isDir });
			if (isDir && expanded[rel]) walk(rel);
		}
	};
	walk("");
	return out;
}

/** Folders above `rel`, outermost first (`a/b/c.ts` → `a`, `a/b`). */
export function ancestorsOf(rel: string): string[] {
	const parts = rel.split("/").slice(0, -1);
	return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
}

export const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);

/** Folder part of a relative path (`a/b/c.ts` → `a/b`, `c.ts` → ``). */
export const parentOf = (rel: string) => rel.split("/").slice(0, -1).join("/");

/** Change state per path from `git status` entries; changed files mark every folder above them `modified`. */
export function statusMap(entries: { path: string; x: string; y: string }[]): Record<string, string> {
	const map: Record<string, string> = {};
	for (const e of entries) {
		map[e.path] = e.x === "?" ? "untracked" : e.x === "D" || e.y === "D" ? "deleted" : "modified";
		const parts = e.path.split("/");
		for (let i = 1; i < parts.length; i++) map[parts.slice(0, i).join("/")] ??= "modified";
	}
	return map;
}

/** What a handled navigation key asks for; every field is optional (a handled key may do nothing). */
interface NavMove {
	/** Move the cursor to this row. */
	focus?: string;
	/** Fold/unfold this folder. */
	toggle?: string;
	/** Activate this row: open the file or toggle the folder. */
	open?: TreeRow;
	/** Start renaming this row. */
	rename?: string;
}

/**
 * Keyboard navigation (WAI-ARIA tree): arrows move or fold, Home/End jump, Enter opens, F2 renames.
 * `null` means the key is not a navigation key and keeps its default behavior.
 */
export function navMove(
	key: string,
	rows: TreeRow[],
	cursor: string,
	expanded: Record<string, boolean>,
): NavMove | null {
	const i = rows.findIndex((r) => r.rel === cursor);
	const cur = rows[i];
	switch (key) {
		case "ArrowDown":
			return { focus: rows[Math.min(rows.length - 1, i + 1)]?.rel };
		case "ArrowUp":
			return { focus: rows[Math.max(0, i - 1)]?.rel };
		case "Home":
			return { focus: rows[0]?.rel };
		case "End":
			return { focus: rows[rows.length - 1]?.rel };
		case "ArrowRight":
			if (cur?.dir && !expanded[cur.rel]) return { toggle: cur.rel };
			return { focus: cur?.dir ? rows[i + 1]?.rel : undefined };
		case "ArrowLeft":
			if (cur?.dir && expanded[cur.rel]) return { toggle: cur.rel };
			return { focus: cur ? parentOf(cur.rel) || undefined : undefined };
		case "Enter":
			return { open: cur };
		case "F2":
			return { rename: cur?.rel };
		default:
			return null;
	}
}
