import { Facet } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import type { LspDoc } from "#lib/lsp/client.svelte.ts";
import { offsetToPos, pathToUri, type Position } from "#lib/lsp/convert.ts";

/** What an editor gives the LSP extensions: its document sync and the host-side effects. */
export interface LspEnv {
	doc: LspDoc;
	/** Open `path` (absolute) with `start..end` (0-based LSP positions) selected, in a tab. */
	openAt: (path: string, start: Position, end?: Position) => void;
	/** Lists of locations (references) shown in a panel. */
	showLocations: (title: string, locations: Location[]) => void;
	/** Settings read live. */
	inlayHints: () => boolean;
	formatOnSave: () => boolean;
}

export interface Location {
	path: string;
	line: number;
	character: number;
	/** End of the target range, when the server gave one. */
	end?: Position;
	/** Source line text for the results list, when known (only same-file hits). */
	preview?: string;
}

/** Single-value facet: the env of the editor (absent = LSP off for this view). */
export const lspEnv = Facet.define<LspEnv, LspEnv | null>({
	combine: (v) => v[0] ?? null,
});

export const envOf = (view: EditorView) => view.state.facet(lspEnv);

/** `textDocument` + `position` params for the caret (or `pos`). */
export function posParams(view: EditorView, env: LspEnv, pos = view.state.selection.main.head) {
	return {
		textDocument: { uri: pathToUri(env.doc.path) },
		position: offsetToPos(view.state.doc, pos),
	};
}
