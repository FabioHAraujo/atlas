/** LSP commands of the focused editor, registered in the app keymap (rebindable, in the palette). */
import type { Command } from "#lib/keymap.svelte.ts";
import { activeEditor } from "#lib/shell/editors.ts";
import { ops } from "#lib/symbols.ts";
import type { EditorView } from "@codemirror/view";

/**
 * The actions pull in the whole editor stack (CodeMirror, language grammars, prettier), which the
 * shell must not load at startup: they are fetched when a command first runs, by which time an
 * editor (and its chunk) exists anyway.
 */
const actions = () => import("#lib/lsp/actions.ts");

/**
 * The focused editor, when a language server serves it and the keyboard focus is inside it: F2/F12
 * must not fire from the palette, the rename prompt or a terminal that merely sits in the same pane.
 */
const lspView = () => {
	const v = activeEditor();
	return v && ops.lspEnv(v)?.doc.open && v.dom.contains(document.activeElement) ? v : undefined;
};

/** Any focused file editor, served by a language server or not (Format falls back to the built-in formatter). */
const focusedEditor = () => {
	const v = activeEditor();
	return v && v.dom.contains(document.activeElement) ? v : undefined;
};

const cmd = (id: string, label: string, fn: (v: EditorView) => unknown): Command => ({
	id,
	label,
	run: () => {
		const v = lspView();
		if (v) void fn(v);
	},
	when: () => !!lspView(),
});

export const lspCommands = (): Command[] => [
	cmd("editor::GoToDefinition", "Go to definition", async (v) => (await actions()).goToDefinition(v)),
	cmd("editor::GoToTypeDefinition", "Go to type definition", async (v) =>
		(await actions()).goToTypeDefinition(v),
	),
	cmd("editor::GoToImplementation", "Go to implementation", async (v) =>
		(await actions()).goToImplementation(v),
	),
	cmd("editor::FindAllReferences", "Find all references", async (v) => (await actions()).findReferences(v)),
	cmd("editor::Rename", "Rename symbol", async (v) => (await actions()).renameSymbol(v)),
	{
		id: "editor::Format",
		label: "Format document",
		run: () => {
			const v = focusedEditor();
			if (v) void import("#lib/viewers/formatAction.ts").then((m) => m.formatActive(v));
		},
		when: () => !!focusedEditor(),
	},
	cmd("editor::ToggleCodeActions", "Code actions", async (v) =>
		(await import("#lib/lsp/extension.ts")).codeActionMenu(v),
	),
];
