/**
 * Glue between LSP (absolute paths) and the workspace (worktree id + relative path): open a
 * location in a tab, find the editor of an absolute path, show reference lists.
 */
import { openFile } from "#lib/stores/files.svelte.ts";
import { ws } from "#lib/stores/workspace.svelte.ts";
import { editors } from "#lib/symbols.ts";
import type { PaletteItem } from "#lib/components/Palette.svelte";
import { fileIcon } from "#lib/icons.ts";
import type { Location } from "#lib/lsp/context.ts";
import type { Position } from "#lib/lsp/convert.ts";
import { showPicker } from "#lib/lsp/picker.svelte.ts";
import { setEditorResolver } from "#lib/lsp/apply.ts";

/** Worktree whose root contains `abs` (deepest root wins), with the relative path. */
export function locate(abs: string) {
	let best: { id: string; rel: string; len: number } | null = null;
	for (const w of ws.doc.worktrees) {
		const root = w.path.endsWith("/") ? w.path : `${w.path}/`;
		if (abs.startsWith(root) && (!best || root.length > best.len))
			best = { id: w.id, rel: abs.slice(root.length), len: root.length };
	}
	return best;
}

export function openLocation(abs: string, pos: Position, preferWorktree?: string) {
	const hit = locate(abs);
	if (!hit) return false;
	openFile(preferWorktree ?? hit.id, hit.rel, pos.line + 1, pos.character + 1);
	return true;
}

setEditorResolver((abs) => {
	const hit = locate(abs);
	return hit ? editors.get(`${hit.id}:${hit.rel}`) : undefined;
});

export function showLocations(title: string, list: Location[]) {
	const sorted = [...list].sort(
		(a, b) => a.path.localeCompare(b.path) || a.line - b.line || a.character - b.character,
	);
	const items: PaletteItem[] = sorted.map((l, i) => {
		const hit = locate(l.path);
		const rel = hit?.rel ?? l.path;
		const name = rel.split("/").pop() ?? rel;
		return {
			id: `${i}`,
			group: rel,
			label: `${name}:${l.line + 1}`,
			description: l.preview,
			icon: fileIcon(name),
			run: () => void openLocation(l.path, l, undefined),
		};
	});
	showPicker(title, items);
}
