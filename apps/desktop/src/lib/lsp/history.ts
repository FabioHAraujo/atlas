/**
 * The app-wide "Go Back / Go Forward" over jump positions (⌃- / ⌃⇧-, VS Code's), fed by every
 * go-to-definition style jump. Distinct from Atlas's tab history (⌘[ / ⌘]), which moves between
 * tabs: this one returns the caret to the exact line and column it left, opening the file if needed.
 */
import type { EditorView } from "@codemirror/view";
import { activeEditor } from "#lib/shell/editors.ts";
import { editorFiles } from "#lib/symbols.ts";
import { offsetToPos } from "#lib/lsp/convert.ts";
import { NavHistory, type NavPos } from "#lib/lsp/navigation.ts";
import { openLocation } from "#lib/lsp/workspace.ts";
import { ws } from "#lib/stores/workspace.svelte.ts";

const chain = new NavHistory();

/** Where the caret of `view` is, as an absolute path and LSP position. */
function here(abs: string, view: EditorView): NavPos {
	const p = offsetToPos(view.state.doc, view.state.selection.main.head);
	return { path: abs, line: p.line, character: p.character };
}

/** Absolute path of the file in `view`, when it is a registered editor. */
function absOf(view: EditorView): string | undefined {
	const f = editorFiles.get(view);
	return f ? (f.path.startsWith("/") ? f.path : `${f.root}/${f.path}`) : undefined;
}

export const navigator = {
	/** Record the caret of `view` (file `abs`) as the position a jump is leaving. */
	leave(abs: string, view: EditorView) {
		chain.push(here(abs, view));
	},

	go(dir: -1 | 1): boolean {
		const view = activeEditor();
		const abs = view && absOf(view);
		if (!view || !abs) return false;
		const now = here(abs, view);
		const to = dir < 0 ? chain.back(now) : chain.forward(now);
		if (!to) return false;
		return openLocation(to.path, to, ws.selected?.id);
	},

	canGo: (dir: -1 | 1) => (dir < 0 ? chain.canBack() : chain.canForward()),
};
