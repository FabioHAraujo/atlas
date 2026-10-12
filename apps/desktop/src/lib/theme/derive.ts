/**
 * `complete()` turns any partial theme (a terminal palette from Ghostty/iTerm, a VS Code theme, a
 * hand-written file with three colors) into one that defines every token in `tokens.ts`.
 * Anything the theme sets is kept verbatim; the rest is derived in OKLCH from the background,
 * foreground, accent and the ANSI hues, so text tokens always reach WCAG AA on their surface.
 */
import {
	color,
	contrast,
	ensureContrast,
	fromOklch,
	isDark,
	mix,
	opaque,
	over,
	toOklch,
	withAlpha,
} from "#lib/theme/color.ts";
import { ROLE_FALLBACK, SYNTAX_ROLES } from "#lib/theme/tokens.ts";
import type { Appearance, SyntaxStyle, ThemeStyle } from "#lib/theme/schema.ts";

const AA = 4.5;

/** Hue (OKLCH degrees) and lightness/chroma a fallback hue takes when the theme has no palette. */
const HUES = { red: 25, orange: 55, yellow: 100, green: 145, cyan: 205, blue: 255, purple: 295, pink: 350 };

type Hue = keyof typeof HUES;

/** A generated hue that works on `bg`: the same lightness class as the foreground, moderate chroma. */
function hue(h: Hue, bg: string, dark: boolean): string {
	return ensureContrast(fromOklch({ l: dark ? 0.8 : 0.45, c: dark ? 0.15 : 0.14, h: HUES[h] }), bg, AA);
}

/** Palette hues for syntax/semantics: the theme's own ANSI colors when present, else generated. */
function palette(s: ThemeStyle, bg: string, dark: boolean): Record<Hue, string> {
	const pick = (key: string, h: Hue) => {
		const c = color(s[key]);
		return c ? opaque(c) : hue(h, bg, dark);
	};
	const red = pick("terminal.ansi.red", "red");
	const green = pick("terminal.ansi.green", "green");
	const yellow = pick("terminal.ansi.yellow", "yellow");
	const blue = pick("terminal.ansi.blue", "blue");
	const pink = pick("terminal.ansi.magenta", "pink");
	const cyan = pick("terminal.ansi.cyan", "cyan");
	// No ANSI slot for orange or purple: orange sits between red and yellow; purple leans on blue.
	const orange = mix(red, yellow, 0.5);
	const purple = mix(blue, pink, 0.35);
	return { red, orange, yellow, green, cyan, blue, purple, pink };
}

/** Surfaces step away from the editor background by lightness; chrome is darker in dark themes. */
function surfaces(bg: string, dark: boolean) {
	const o = toOklch(bg);
	const at = (d: number) => fromOklch({ l: o.l + d, c: o.c, h: o.h });
	return {
		sunken: at(dark ? -0.04 : -0.03),
		raised: at(dark ? 0.04 : 0.03),
		overlay: at(dark ? 0.08 : 0.06),
	};
}

const set = (s: ThemeStyle, key: string, v: string | undefined) => {
	if (v && !color(s[key])) s[key] = v;
};

/** A new style with every token defined. Never mutates `input`. */
export function complete(input: ThemeStyle, appearance: Appearance): ThemeStyle {
	const s: ThemeStyle = { ...input, syntax: { ...input.syntax } };
	const termBg = color(s["terminal.background"]);
	const bg = opaque(
		color(s["editor.background"]) ?? termBg ?? (appearance === "dark" ? "#1e1e1e" : "#ffffff"),
	);
	const dark = isDark(bg);
	const fg = opaque(
		color(s.text) ??
			color(s["editor.foreground"]) ??
			color(s["terminal.foreground"]) ??
			(dark ? "#e6e6e6" : "#1a1a1a"),
	);
	const pal = palette(s, bg, dark);
	const accent = opaque(color(s["text.accent"]) ?? (dark ? pal.blue : pal.blue));
	const sf = surfaces(bg, dark);

	set(s, "editor.background", bg);
	set(s, "background", sf.sunken);
	set(s, "surface.background", sf.raised);
	set(s, "elevated_surface.background", sf.overlay);
	set(s, "text", fg);
	const raised = opaque(color(s["elevated_surface.background"]) ?? sf.overlay);
	// Muted text must be AA on the lightest chrome surface it sits on, disabled only needs to read.
	set(s, "text.muted", ensureContrast(mix(fg, bg, 0.28), raised, AA));
	set(s, "text.disabled", mix(fg, bg, 0.55));
	set(s, "text.accent", ensureContrast(accent, raised, AA));
	set(s, "text.on_accent", contrast("#ffffff", accent) >= AA ? "#ffffff" : bg);
	set(s, "border", withAlpha(fg, 0.16));
	set(s, "border.variant", withAlpha(fg, 0.08));
	set(s, "border.focused", withAlpha(fg, 0.3));
	set(s, "border.selected", ensureContrast(accent, bg, 3));
	set(s, "element.hover", withAlpha(fg, dark ? 0.075 : 0.055));
	set(s, "element.selected", withAlpha(fg, dark ? 0.13 : 0.09));
	set(s, "created", ensureContrast(pal.green, raised, AA));
	set(s, "warning", ensureContrast(pal.orange, raised, AA));
	set(s, "info", ensureContrast(pal.cyan, raised, AA));
	set(s, "error", ensureContrast(pal.red, raised, AA));
	for (const [k, from] of [
		["state.success", "created"],
		["state.warning", "warning"],
		["state.info", "info"],
		["state.error", "error"],
		["version_control.added", "created"],
		["version_control.modified", "warning"],
		["version_control.deleted", "error"],
		["version_control.renamed", "info"],
	] as const)
		set(s, k, color(s[from]));
	set(s, "scrollbar.thumb.background", withAlpha(fg, 0.22));
	set(s, "scrollbar.thumb.hover_background", withAlpha(fg, 0.4));
	set(s, "link_text.hover", color(s.info));

	set(s, "editor.foreground", fg);
	set(s, "editor.active_line.background", withAlpha(fg, dark ? 0.06 : 0.05));
	set(s, "editor.line_number", color(s["text.disabled"]));
	set(s, "editor.active_line_number", color(s["text.muted"]));
	set(s, "editor.document_highlight.read_background", withAlpha(accent, 0.2));
	set(s, "editor.document_highlight.bracket_background", withAlpha(accent, 0.3));
	set(s, "search.match_background", withAlpha(pal.yellow, 0.3));
	set(s, "search.active_match_background", withAlpha(pal.orange, 0.55));
	const player = { ...s.players?.[0] };
	player.cursor ??= accent;
	player.selection ??= withAlpha(accent, 0.28);
	s.players = [player, ...(s.players?.slice(1) ?? [])];

	completeTerminal(s, bg, fg, pal, dark);
	completeSyntax(s, fg, pal, bg);
	return s;
}

/** ANSI slots a theme omits come from the generated hues; `bright_*` lift the normal color. */
function completeTerminal(s: ThemeStyle, bg: string, fg: string, pal: Record<Hue, string>, dark: boolean) {
	const base = ["black", "red", "green", "yellow", "blue", "magenta", "cyan", "white"] as const;
	const normal: Record<(typeof base)[number], string> = {
		black: dark ? mix(bg, "#000000", 0.4) : mix(bg, "#000000", 0.85),
		red: pal.red,
		green: pal.green,
		yellow: pal.yellow,
		blue: pal.blue,
		magenta: pal.pink,
		cyan: pal.cyan,
		white: dark ? mix(fg, bg, 0.12) : mix(fg, "#ffffff", 0.35),
	};
	for (const n of base) set(s, `terminal.ansi.${n}`, normal[n]);
	const lift = (c: string) => {
		const o = toOklch(c);
		return fromOklch({ ...o, l: Math.min(0.98, Math.max(0.02, o.l + (dark ? 0.06 : -0.06))) });
	};
	for (const n of base) {
		const own = color(s[`terminal.ansi.${n}`]) ?? normal[n];
		set(
			s,
			`terminal.ansi.bright_${n}`,
			n === "black" ? mix(own, fg, 0.35) : n === "white" ? (dark ? "#ffffff" : "#000000") : lift(own),
		);
	}
	set(s, "terminal.background", bg);
	set(s, "terminal.foreground", fg);
	set(s, "terminal.cursor", color(s.players?.[0]?.cursor));
	set(s, "terminal.cursor_text", bg);
	set(
		s,
		"terminal.selection.background",
		over(color(s.players?.[0]?.selection) ?? withAlpha(fg, 0.25), bg, 1),
	);
	set(s, "terminal.selection.foreground", fg);
}

/** Classic scope mapping (keywords pink-like, functions green-like, …) applied to the ANSI hues. */
function completeSyntax(s: ThemeStyle, fg: string, pal: Record<Hue, string>, bg: string) {
	const syntax = s.syntax as Record<string, SyntaxStyle>;
	const base: Record<string, [string, SyntaxStyle["font_style"]?]> = {
		variable: [fg],
		property: [fg],
		string: [pal.yellow],
		number: [pal.purple],
		comment: [ensureContrast(mix(fg, bg, 0.6), bg, 3), "italic"],
		punctuation: [fg],
		keyword: [pal.pink],
		type: [pal.cyan],
		function: [pal.green],
		title: [pal.purple],
		tag: [pal.pink],
		link_uri: [pal.cyan],
		emphasis: [fg, "italic"],
		boolean: [pal.orange],
		constant: [pal.orange],
		attribute: [pal.green],
		"variable.special": [pal.purple, "italic"],
		"variable.parameter": [pal.orange, "italic"],
	};
	for (const [role, [c, style]] of Object.entries(base)) {
		if (color(syntax[role]?.color)) continue;
		syntax[role] = { ...syntax[role], color: c, font_style: syntax[role]?.font_style ?? style ?? null };
	}
	// Remaining roles inherit along ROLE_FALLBACK (comment.doc ← comment, boolean ← number, …).
	for (const role of SYNTAX_ROLES) {
		let cur: string | undefined = role;
		while (cur && !color(syntax[cur]?.color)) cur = ROLE_FALLBACK[cur as keyof typeof ROLE_FALLBACK];
		const src = cur ? syntax[cur] : undefined;
		if (!color(syntax[role]?.color) && src)
			syntax[role] = {
				color: src.color,
				font_style: syntax[role]?.font_style ?? src.font_style ?? null,
				font_weight: syntax[role]?.font_weight ?? null,
			};
	}
	if (!syntax.title?.font_weight) syntax.title = { ...syntax.title, font_weight: 700 };
}
