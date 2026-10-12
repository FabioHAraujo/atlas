/**
 * Glue between LSP (absolute paths) and the workspace (worktree id + relative path): open a
 * location in a tab, find the editor of an absolute path, show reference lists.
 */
import { openFile } from "#lib/stores/files.svelte.ts";
import { editorKey, resolveTarget, tabFor } from "#lib/lsp/navigation.ts";
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

/**
 * Open `abs` at `pos` in a tab. Inside a worktree it opens there; dependency sources (`node_modules`)
 * and files outside every worktree (Rust std, cargo registry) open read-only in a tab of
 * `hostWorktree`, addressed by absolute path. Returns false only when no worktree can host the tab.
 */
export function openLocation(abs: string, pos: Position, hostWorktree?: string, end?: Position): boolean {
	const tab = tabFor(resolveTarget(abs, ws.doc.worktrees), hostWorktree);
	if (!tab) return false;
	if (tab.readOnly) readOnlyPaths.add(editorKey(tab.worktreeId, tab.path));
	openFile(
		tab.worktreeId,
		tab.path,
		pos.line + 1,
		pos.character + 1,
		end && { line: end.line + 1, col: end.character + 1 },
	);
	return true;
}

/** Tabs that must open read-only (dependency and external sources): read by `Editor.svelte` on mount. */
export const readOnlyPaths = new Set<string>();

setEditorResolver((abs) => {
	const t = tabFor(resolveTarget(abs, ws.doc.worktrees), ws.selected?.id);
	return t ? editors.get(editorKey(t.worktreeId, t.path)) : undefined;
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
			run: () => void openLocation(l.path, l, ws.selected?.id, l.end),
		};
	});
	showPicker(title, items);
}
