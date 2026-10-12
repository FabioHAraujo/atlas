/**
 * What a theme card draws: the Dracula spec test snippet tokenized into syntax roles, plus the
 * colors read from a COMPLETED theme style. Pure: no Svelte, no IPC.
 */
import type { Theme } from "#lib/theme.ts";
import { color, opaque } from "#lib/theme/color.ts";
import { complete } from "#lib/theme/derive.ts";
import { ANSI_KEYS } from "#lib/theme/tokens.ts";

type Role =
	| "comment"
	| "keyword"
	| "function"
	| "string"
	| "number"
	| "type"
	| "variable"
	| "variable.special"
	| "punctuation";

export interface Tok {
	text: string;
	role: Role;
}

/** Code lines of the sample (Dracula spec test snippet); a theme colors each token through its syntax role. */
export const SAMPLE: Tok[][] = [
	[{ text: "// Once upon a time...", role: "comment" }],
	[
		{ text: "class ", role: "keyword" },
		{ text: "Vampire", role: "type" },
		{ text: " {", role: "punctuation" },
	],
	[
		{ text: "  constructor", role: "function" },
		{ text: "(", role: "punctuation" },
		{ text: "props", role: "variable" },
		{ text: ") {", role: "punctuation" },
	],
	[
		{ text: "    this", role: "variable.special" },
		{ text: ".location = props.location;", role: "punctuation" },
	],
	[
		{ text: "    return ", role: "keyword" },
		{ text: "this", role: "variable.special" },
		{ text: ".age + ", role: "punctuation" },
		{ text: "42", role: "number" },
		{ text: " + ", role: "punctuation" },
		{ text: '"bite"', role: "string" },
	],
];

/** Index of the line drawn as the active line, and of the one drawn with a selection. */
export const ACTIVE_LINE = 2;
export const SELECTED_LINE = 3;

/** Terminal strip: an `ls --color`-like listing using ANSI slots 0..15, or the plain foreground. */
export interface Cell {
	text: string;
	ansi: number | "fg";
}
export const TERMINAL_LINES: Cell[][] = [
	[
		{ text: "~/atlas ", ansi: 4 },
		{ text: "$ ls --color", ansi: "fg" },
	],
	[
		{ text: "src/  ", ansi: 12 },
		{ text: "bin/  ", ansi: 10 },
		{ text: "a.tar  ", ansi: 9 },
		{ text: "link  ", ansi: 14 },
		{ text: "README", ansi: "fg" },
	],
];

export interface SyntaxPaint {
	color: string;
	italic: boolean;
	bold: boolean;
}

export interface PreviewModel {
	chrome: string;
	surface: string;
	editorBg: string;
	editorFg: string;
	gutter: string;
	gutterActive: string;
	activeLine: string;
	selection: string;
	accent: string;
	border: string;
	text: string;
	muted: string;
	termBg: string;
	termFg: string;
	cursor: string;
	/** ANSI 0..15 (`#rrggbb`). */
	ansi: string[];
	syntax: Record<Role, SyntaxPaint>;
}

const hex = (v: unknown, fallback: string): string => color(v) ?? fallback;

function paint(style: Theme["style"], role: string, fallback: string): SyntaxPaint {
	const s = style.syntax?.[role];
	return {
		color: hex(s?.color, fallback),
		italic: s?.font_style === "italic",
		bold: typeof s?.font_weight === "number" && s.font_weight >= 600,
	};
}

/** Colors of `theme` for the preview. `complete()` fills whatever a user file left out. */
export function previewModel(theme: Pick<Theme, "style" | "appearance">): PreviewModel {
	const s = complete(theme.style, theme.appearance);
	const editorBg = hex(s["editor.background"], "#000000");
	const editorFg = hex(s["editor.foreground"], "#ffffff");
	const termFg = hex(s["terminal.foreground"], editorFg);
	return {
		chrome: hex(s.background, editorBg),
		surface: hex(s["surface.background"], editorBg),
		editorBg,
		editorFg,
		gutter: hex(s["editor.line_number"], editorFg),
		gutterActive: hex(s["editor.active_line_number"], editorFg),
		activeLine: hex(s["editor.active_line.background"], "#00000000"),
		selection: hex(s.players?.[0]?.selection, "#00000000"),
		accent: hex(s["text.accent"], editorFg),
		border: hex(s.border, "#00000000"),
		text: hex(s.text, editorFg),
		muted: hex(s["text.muted"], editorFg),
		termBg: hex(s["terminal.background"], editorBg),
		termFg,
		cursor: hex(s["terminal.cursor"], termFg),
		ansi: ANSI_KEYS.map((k) => opaque(hex(s[k], termFg))),
		syntax: {
			comment: paint(s, "comment", editorFg),
			keyword: paint(s, "keyword", editorFg),
			function: paint(s, "function", editorFg),
			string: paint(s, "string", editorFg),
			number: paint(s, "number", editorFg),
			type: paint(s, "type", editorFg),
			variable: paint(s, "variable", editorFg),
			"variable.special": paint(s, "variable.special", editorFg),
			punctuation: paint(s, "punctuation", editorFg),
		},
	};
}
