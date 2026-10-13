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
	legible(s, dark);
	return s;
}

/** The chrome surfaces UI text sits on: sidebar/chrome, editor, raised, overlay. */
const SURFACE_KEYS = ["background", "editor.background", "surface.background", "elevated_surface.background"];
/** Share of the sidebar the native window material shows through; `Sidebar.svelte` paints `--ca-surface-sunken` at 1 minus this. */
export const SIDEBAR_SEE_THROUGH = 0.18;

/**
 * The legibility guarantee, for explicit theme values and derived ones alike (a theme file, a Ghostty import or a
 * VS Code theme can all ship a muted grey that vanishes on its own sidebar). Every UI text token is moved along
 * lightness, keeping hue and chroma, until it reaches its floor on the WORST surface it can sit on (the four chrome
 * surfaces, and the sidebar with the native window material showing through: white under a light theme, black
 * under a dark one):
 *  - 4.5 (WCAG AA body): text, text.muted, text.accent, the semantic colours, the link colour;
 *  - 3 (documented relaxation: WCAG exempts disabled controls and placeholders, they must still read): text.disabled;
 *  - 3: the keyboard focus ring and the state indicators (non-text UI).
 * Terminal and syntax colours and `editor.line_number` are never touched here (specs such as Dracula pin them).
 */
function legible(s: ThemeStyle, dark: boolean) {
	const surf = SURFACE_KEYS.map((k) => opaque(color(s[k])!));
	const sidebar = over(surf[0]!, dark ? "#000000" : "#ffffff", 1 - SIDEBAR_SEE_THROUGH);
	const lift = (key: string, min: number, on: string[]) => {
		const c = opaque(color(s[key])!);
		// moving along lightness toward the readable side only ever raises contrast on every surface of that side
		const worst = on.reduce((w, bg) => (contrast(c, bg) < contrast(c, w) ? bg : w));
		s[key] = ensureContrast(c, worst, min);
	};
	const text = [...surf, sidebar];
	lift("text", AA, text);
	// Tinted controls sit on those surfaces too: the kit's kbd chip is the text colour at 6% over its surface, the
	// selected row `element.selected`, and the selected palette row / current project are an ACCENT at 16% (the brand
	// colour, or any space hue at the shell's tone). Muted text must read on all of them (measured: the ⌘K chip
	// dropped it to 4.33, the current project name to 3.75). The tint depends on the text colour, which the lift
	// itself moves: iterate to a fixed point (converges in 2).
	const spaceHues = Array.from({ length: 24 }, (_, i) =>
		fromOklch({ l: dark ? 0.74 : 0.62, c: dark ? 0.14 : 0.17, h: i * 15 }),
	);
	for (let pass = 0; pass < 3; pass++) {
		const tints = [0.06, dark ? 0.13 : 0.09].flatMap((a) =>
			text.map((bg) => over(opaque(color(s.text)!), bg, a)),
		);
		const accents = [opaque(color(s["text.accent"])!), ...spaceHues].flatMap((c) =>
			text.map((bg) => over(c, bg, 0.16)),
		);
		// The kit's hover/active fill (`--ca-vibrancy-fill`: near-white 10% in dark themes, near-black in light ones),
		// alone and under a kbd chip (text 6%): measured 4.04-4.43:1 in One Dark and Dracula. An accent tint never
		// stacks on it in the UI (the current row replaces the hover fill), so that stack is not guarded.
		const fill = dark ? "#ffffff" : "#000000";
		const stacks = text.flatMap((bg) => {
			const base = over(fill, bg, 0.12);
			return [base, over(opaque(color(s.text)!), base, 0.06)];
		});
		for (const k of ["text", "text.muted"]) lift(k, AA, [...text, ...tints, ...accents, ...stacks]);
	}
	// Status chips and tags set `color: var(--tone)` on `color-mix(var(--tone) 10-14%, transparent)`: the tint of the
	// colour itself costs it contrast (measured 3.7-4.5:1). Each reads on its own 10% and 14% tint; like the text
	// tints, the tint follows the lifted colour, so iterate.
	for (const k of ["text.accent", "created", "warning", "info", "error", "link_text.hover"])
		for (let pass = 0; pass < 3; pass++) {
			const own = [0.1, 0.14].flatMap((a) => text.map((bg) => over(opaque(color(s[k])!), bg, a)));
			lift(k, AA, [...text, ...own]);
		}
	lift("text.disabled", 3, text);
	for (const k of ["border.selected", "state.success", "state.warning", "state.info", "state.error"])
		lift(k, 3, surf);
	lift("editor.line_number", 3, [surf[1]!]);
	// Text on the accent fill: a theme's own choice stays when it reads, else the better of white and black.
	const accent = opaque(color(s["text.accent"])!);
	const onAccent = color(s["text.on_accent"]);
	if (!onAccent || contrast(opaque(onAccent), accent) < AA)
		s["text.on_accent"] = contrast("#ffffff", accent) >= contrast("#000000", accent) ? "#ffffff" : "#000000";
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
