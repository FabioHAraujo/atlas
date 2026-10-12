/**
 * The live editors (by `worktreeId:path`), their save and go-to-line. Pure bookkeeping: the shell
 * imports this at startup, so it must not pull CodeMirror in. The CodeMirror-backed operations
 * (`outline.ts`) install themselves into `ops` when the first editor's chunk loads, which is
 * always before any editor can be asked for them.
 */
import type { EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { LspEnv } from "#lib/lsp/context.ts";

/** An outline entry: name, node kind without the grammar suffix (`Function`, `Class`, `H2`…), offset, line. */
export interface OutlineSymbol {
	name: string;
	kind: string;
	from: number;
	line: number;
}

/** CodeMirror-backed operations, set by `outline.ts`. */
export const ops: {
	outline: (state: EditorState) => OutlineSymbol[];
	/** Put the caret at `pos` and scroll it to the middle of the view. */
	reveal: (view: EditorView, pos: number) => void;
	/** The CodeMirror view mounted in `.cm-editor` element `host`. */
	viewOf: (host: HTMLElement) => EditorView | undefined;
	/** The language-server env an editor was built with (absent: LSP off for this view). */
	lspEnv: (view: EditorView) => LspEnv | null;
	/** Edit menu actions on a CodeMirror view (⌘Z ⇧⌘Z ⌘A); whether the command handled it. */
	edit: (view: EditorView, action: "undo" | "redo" | "selectAll") => boolean;
} = {
	outline: () => [],
	reveal: () => {},
	viewOf: () => undefined,
	lspEnv: () => null,
	edit: () => false,
};

/** Live editors by `worktreeId:path`, registered by Editor.svelte. */
export const editors = new Map<string, EditorView>();

/** Each live editor's save (writes the document if it changed), by the same key. */
export const savers = new Map<string, () => Promise<void>>();

/** Worktree-relative path and absolute worktree root of each live editor, by the same key (used by Format). */
export const editorFiles = new WeakMap<EditorView, { path: string; root: string }>();

/**
 * ⌘S: save the editor `key` (the focused pane's) now. `false` when there is none, so the
 * caller can say "Nothing to save" instead of silently doing nothing.
 */
export async function saveEditor(key: string | undefined): Promise<boolean> {
	const save = key ? savers.get(key) : undefined;
	if (!save) return false;
	await save();
	return true;
}

/** ⌥⌘S: save every open file editor (the atlas.yaml review dialog is only for ⌘S). Returns how many. */
export async function saveAllEditors(): Promise<number> {
	const all = [...savers].filter(([key]) => editors.has(key)).map(([, save]) => save);
	await Promise.all(all.map((s) => s()));
	return all.length;
}

/** Line (and column) requested for an editor that is not mounted yet; consumed on registration. */
const pendingGoto = new Map<string, { line: number; col?: number }>();

/** Put the caret at `line[:col]` (1-based) and scroll it to the middle; clamps to the document. */
function gotoLine(view: EditorView, line: number, col?: number) {
	const doc = view.state.doc;
	const ln = doc.line(Math.min(Math.max(1, line), doc.lines));
	const pos = ln.from + Math.min(Math.max(0, (col ?? 1) - 1), ln.length);
	ops.reveal(view, pos);
	view.focus();
}

/** Jump to a line of an editor: now if it is open, otherwise as soon as it registers. */
export function requestGoto(key: string, line: number, col?: number) {
	const view = editors.get(key);
	if (view) gotoLine(view, line, col);
	else pendingGoto.set(key, { line, col });
}

/** Called by Editor.svelte right after it registers `view`. */
export function registerEditor(
	key: string,
	view: EditorView,
	save?: () => Promise<void>,
	file?: { path: string; root: string },
) {
	editors.set(key, view);
	if (file) editorFiles.set(view, file);
	if (save) savers.set(key, save);
	const want = pendingGoto.get(key);
	if (want) {
		pendingGoto.delete(key);
		gotoLine(view, want.line, want.col);
	}
}

/** Editor.svelte on destroy: forget `key` if it is still this `view`. */
export function unregisterEditor(key: string, view: EditorView) {
	if (editors.get(key) !== view) return;
	editors.delete(key);
	savers.delete(key);
}
