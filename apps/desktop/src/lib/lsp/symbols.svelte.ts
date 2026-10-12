/** Document symbols from the language server, flattened for the "Go to symbol" palette. State only: loading is `symbolsLoad.ts`, so the shell does not import CodeMirror. */
import type { EditorView } from "@codemirror/view";

export interface LspSymbol {
	name: string;
	kind: string;
	from: number;
	line: number;
	container?: string;
}

/** Latest result per view; the palette reads it reactively, `loadSymbols` fills it when it opens. */
export const lspSymbols = $state<{ view: EditorView | null; list: LspSymbol[] | null }>({
	view: null,
	list: null,
});
