/**
 * What clicking a status bar item does: each opens the shared list picker with the choices, or
 * jumps (go to line). The component supplies the editor operations; this module is the menu
 * content, so the wording and the choices live in one place.
 */
import type { PaletteItem } from "#lib/components/Palette.svelte";
import { showPicker } from "#lib/lsp/picker.svelte.ts";
import type { Eol } from "#lib/editor/detect.ts";

export interface StatusOps {
	indent: { style: "space" | "tab"; size: number };
	eol: Eol | "mixed";
	setIndent: (style: "space" | "tab", size: number) => void;
	/** Rewrite the file's existing indentation to the given style (undoable). */
	convertIndent: (style: "space" | "tab") => void;
	setEol: (eol: Eol) => void;
	gotoLine: () => void;
	showProblems: () => void;
}

const SIZES = [1, 2, 3, 4, 6, 8];
const EOLS: { id: Eol; label: string; description: string }[] = [
	{ id: "lf", label: "LF", description: "Unix and macOS" },
	{ id: "crlf", label: "CRLF", description: "Windows" },
	{ id: "cr", label: "CR", description: "Classic Mac OS" },
];

const item = (
	group: string,
	label: string,
	run: () => void,
	extra: Partial<PaletteItem> = {},
): PaletteItem => ({
	id: `${group}:${label}`,
	group,
	label,
	run,
	...extra,
});

/** Open the picker (or act) for status item `id`. Unknown ids do nothing. */
export function runStatusAction(id: string, ops: StatusOps) {
	switch (id) {
		case "position":
			return ops.gotoLine();
		case "problems":
			return ops.showProblems();
		case "indent": {
			const cur = ops.indent;
			const items: PaletteItem[] = [
				...(["space", "tab"] as const).flatMap((style) =>
					SIZES.map((size) =>
						item(
							style === "space" ? "Indent using spaces" : "Indent using tabs",
							style === "space" ? `Spaces: ${size}` : `Tab Size: ${size}`,
							() => ops.setIndent(style, size),
							{ description: cur.style === style && cur.size === size ? "current" : undefined },
						),
					),
				),
				item("Convert file", "Convert indentation to spaces", () => ops.convertIndent("space")),
				item("Convert file", "Convert indentation to tabs", () => ops.convertIndent("tab")),
			];
			return showPicker("Select indentation", items);
		}
		case "eol":
			return showPicker(
				"Select end of line sequence",
				EOLS.map((e) =>
					item("Line ending", e.label, () => ops.setEol(e.id), {
						description: ops.eol === e.id ? `${e.description} · current` : e.description,
					}),
				),
			);
		default:
			return undefined;
	}
}
