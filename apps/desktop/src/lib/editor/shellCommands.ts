/**
 * Editor commands of the focused file editor for the app command palette (rebindable in the
 * keymap, listed with their binding). CodeMirror and its commands are fetched when one first
 * runs: the shell must not load the editor stack at startup (same rule as `lsp/commands.ts`).
 */
import type { EditorView } from "@codemirror/view";
import type { Command } from "#lib/keymap.svelte.ts";
import { activeEditor } from "#lib/shell/editors.ts";
import { sessionOf } from "#lib/editor/registry.ts";

const focused = () => {
	const v = activeEditor();
	return v && v.dom.contains(document.activeElement) ? v : undefined;
};

/** Palette entries only: ids and labels, the work lives in `editor/keymap.ts` (lazy). */
const COMMANDS: { id: string; label: string }[] = [
	{ id: "editor::TrimTrailingWhitespace", label: "Trim trailing whitespace" },
	{ id: "editor::ConvertIndentationToSpaces", label: "Convert indentation to spaces" },
	{ id: "editor::ConvertIndentationToTabs", label: "Convert indentation to tabs" },
	{ id: "editor::FoldAllCommand", label: "Fold all" },
	{ id: "editor::UnfoldAllCommand", label: "Unfold all" },
	{ id: "editor::SortLinesAscending", label: "Sort lines ascending" },
	{ id: "editor::SortLinesDescending", label: "Sort lines descending" },
	{ id: "editor::DuplicateLine", label: "Duplicate line" },
	{ id: "editor::ReindentSelectionCommand", label: "Reindent selection" },
	{ id: "editor::TransformToUppercase", label: "Transform to uppercase" },
	{ id: "editor::TransformToLowercase", label: "Transform to lowercase" },
	{ id: "editor::JoinLinesCommand", label: "Join lines" },
];

const run = (id: string, v: EditorView) =>
	void import("#lib/editor/keymap.ts").then((m) => m.editorCommands.find((c) => c.id === id)?.run(v));

const session = () => {
	const v = focused();
	return v ? sessionOf(v) : undefined;
};

export const editorShellCommands = (): Command[] => [
	...COMMANDS.map(({ id, label }) => ({
		id,
		label,
		run: () => {
			const v = focused();
			if (v) run(id, v);
		},
		when: () => !!focused(),
	})),
	{
		id: "editor::ToggleSoftWrap",
		label: "Toggle word wrap",
		run: () => {
			const s = session();
			if (s) s.setWrap(!s.wrap);
		},
		when: () => !!session(),
	},
	{
		id: "editor::RevertFile",
		label: "Revert file",
		run: () => void session()?.revert(),
		when: () => !!session()?.dirty,
	},
];
