/** LSP commands of the focused editor, registered in the app keymap (rebindable, in the palette). */
import type { Command } from "#lib/keymap.svelte.ts";
import { activeEditor } from "#lib/shell/editors.ts";
import { codeActionMenu } from "#lib/lsp/extension.ts";
import { formatActive } from "#lib/viewers/formatAction.ts";
import {
	findReferences,
	goToDefinition,
	goToImplementation,
	goToTypeDefinition,
	renameSymbol,
} from "#lib/lsp/actions.ts";
import { envOf } from "#lib/lsp/context.ts";
import type { EditorView } from "@codemirror/view";

/**
 * The focused editor, when a language server serves it and the keyboard focus is inside it: F2/F12
 * must not fire from the palette, the rename prompt or a terminal that merely sits in the same pane.
 */
const lspView = () => {
	const v = activeEditor();
	return v && envOf(v)?.doc.open && v.dom.contains(document.activeElement) ? v : undefined;
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
	cmd("editor::GoToDefinition", "Go to definition", goToDefinition),
	cmd("editor::GoToTypeDefinition", "Go to type definition", goToTypeDefinition),
	cmd("editor::GoToImplementation", "Go to implementation", goToImplementation),
	cmd("editor::FindAllReferences", "Find all references", findReferences),
	cmd("editor::Rename", "Rename symbol", renameSymbol),
	{
		id: "editor::Format",
		label: "Format document",
		run: () => {
			const v = focusedEditor();
			if (v) void formatActive(v);
		},
		when: () => !!focusedEditor(),
	},
	cmd("editor::ToggleCodeActions", "Code actions", codeActionMenu),
];
