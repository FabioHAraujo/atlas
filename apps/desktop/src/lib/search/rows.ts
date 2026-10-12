import type { FileResult, SearchMatch } from "#lib/search/parse.ts";

export type Row =
	| { kind: "file"; key: string; path: string; count: number }
	| { kind: "match"; key: string; path: string; match: SearchMatch };

/** Flat list for keyboard navigation: a header per file followed by its matches (unless collapsed). */
export function flatRows(files: FileResult[], collapsed: Record<string, boolean>): Row[] {
	const out: Row[] = [];
	for (const f of files) {
		out.push({ kind: "file", key: f.path, path: f.path, count: f.matches.length });
		if (collapsed[f.path]) continue;
		f.matches.forEach((m, i) =>
			out.push({ kind: "match", key: `${f.path}:${m.line}:${m.start}:${i}`, path: f.path, match: m }),
		);
	}
	return out;
}

/** Preview text split around the match; leading indentation is dropped so more of the line shows. */
export function previewRuns(m: SearchMatch): { text: string; hit: boolean }[] {
	const lead = m.text.length - m.text.trimStart().length;
	const start = Math.max(0, m.start - lead);
	const end = Math.max(start, m.end - lead);
	const t = m.text.slice(lead);
	if (end <= start) return [{ text: t, hit: false }];
	return [
		{ text: t.slice(0, start), hit: false },
		{ text: t.slice(start, end), hit: true },
		{ text: t.slice(end), hit: false },
	].filter((r) => r.text);
}

export const dirOf = (p: string) => p.split("/").slice(0, -1).join("/");
export const nameOf = (p: string) => p.split("/").pop() ?? p;

export type NavAction =
	| { type: "move"; to: number }
	/** ArrowUp on the first row: back to the query field. */
	| { type: "leave" }
	| { type: "open" }
	/** Fold (←) or unfold (→) a file row. */
	| { type: "fold"; path: string; collapsed: boolean }
	/** A handled key that changes nothing (→ on a match row). */
	| { type: "swallow" };

/** What a key does to the result tree with `cursor` on `rows`; `null` for keys the tree ignores. */
export function navKey(key: string, rows: Row[], cursor: number): NavAction | null {
	switch (key) {
		case "ArrowDown":
			return { type: "move", to: cursor + 1 };
		case "ArrowUp":
			return cursor === 0 ? { type: "leave" } : { type: "move", to: cursor - 1 };
		case "Enter":
			return { type: "open" };
		case "ArrowLeft":
		case "ArrowRight": {
			const r = rows[cursor];
			if (r?.kind === "file") return { type: "fold", path: r.path, collapsed: key === "ArrowLeft" };
			if (r && key === "ArrowLeft") {
				const i = rows.findLastIndex((x, j) => j < cursor && x.kind === "file");
				if (i >= 0) return { type: "move", to: i };
			}
			return { type: "swallow" };
		}
		default:
			return null;
	}
}
