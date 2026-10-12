/** Theme → CSS vars, terminal palette, xterm theme and editor syntax. Schema: `theme/schema.ts`, tokens: `theme/tokens.ts`. */

import { ANSI_VARS } from "#lib/ansi.ts";
import { color, opaque } from "#lib/theme/color.ts";
import type { Appearance, SyntaxStyle, ThemeStyle } from "#lib/theme/schema.ts";
import {
	ANSI_KEYS,
	ANSI_NAMES,
	EDITOR_TOKENS,
	PLAYER_TOKENS,
	SYNTAX_ROLES,
	UI_TOKENS,
	synVar,
} from "#lib/theme/tokens.ts";

export { color } from "#lib/theme/color.ts";
export {
	DEFAULT_SELECTION,
	THEME_VERSION,
	migrateSelection,
	parseFamily,
	resolveTheme,
	validateStyle,
} from "#lib/theme/schema.ts";
export type { Appearance, Issue, Theme, ThemeFont, ThemeSelection, ThemeStyle } from "#lib/theme/schema.ts";

/** Style → every CSS custom property it sets. Missing keys are left out so kit defaults apply. */
export function cssVars(style: ThemeStyle): Record<string, string> {
	const out: Record<string, string> = {};
	// Service logs and the terminal share one palette: slots the theme leaves out keep app.css's defaults.
	ansi16(style).forEach((c, i) => {
		if (c) out[ANSI_VARS[i]] = c;
	});
	for (const [key, vars] of Object.entries(UI_TOKENS)) {
		const c = color(style[key]);
		if (c) for (const v of vars) out[v] = c;
	}
	for (const [key, v] of Object.entries(EDITOR_TOKENS)) {
		const c = color(style[key]);
		if (c) out[v] = c;
	}
	const player = style.players?.[0];
	const caret = color(player?.cursor);
	if (caret) out[PLAYER_TOKENS.cursor] = caret;
	const selection = color(player?.selection);
	if (selection) out[PLAYER_TOKENS.selection] = selection;
	const roles: Record<string, true> = Object.fromEntries(SYNTAX_ROLES.map((r) => [r, true] as const));
	for (const [key, tok] of Object.entries(syntaxTokens(style))) {
		if (!(key in roles)) continue;
		if (tok.color) out[synVar(key)] = tok.color;
		if (tok.italic) out[`${synVar(key)}-italic`] = "italic";
		if (tok.weight) out[`${synVar(key)}-weight`] = tok.weight;
	}
	return out;
}

/** ANSI order 0..15: normal black…white, then bright black…white. `null` = use the terminal default. */
export function ansi16(style: ThemeStyle): (string | null)[] {
	return ANSI_KEYS.map((k) => (color(style[k]) ? opaque(color(style[k])!) : null));
}

export interface TerminalColors {
	/** `null` = fall back to the surface/text CSS variables (or the terminal default). */
	fg: string | null;
	bg: string | null;
	cursor: string | null;
	cursorText: string | null;
	selectionBg: string | null;
	selectionFg: string | null;
	ansi16: (string | null)[];
}

const solid = (v: unknown): string | null => {
	const c = color(v);
	return c ? opaque(c) : null;
};

export function terminalColors(style: ThemeStyle): TerminalColors {
	return {
		fg: solid(style["terminal.foreground"]),
		bg: solid(style["terminal.background"]),
		cursor: solid(style["terminal.cursor"]) ?? solid(style.players?.[0]?.cursor),
		cursorText: solid(style["terminal.cursor_text"]),
		selectionBg: solid(style["terminal.selection.background"]),
		selectionFg: solid(style["terminal.selection.foreground"]),
		ansi16: ansi16(style),
	};
}

/** xterm.js theme; fields stay undefined when the theme says nothing so the caller's defaults apply. */
export function xtermTheme(style: ThemeStyle): Record<string, string | undefined> {
	const t = terminalColors(style);
	const names = [...ANSI_NAMES, ...ANSI_NAMES.map((n) => `bright${n[0].toUpperCase()}${n.slice(1)}`)];
	const sel = color(style["terminal.selection.background"]);
	const out: Record<string, string | undefined> = {
		background: t.bg ?? undefined,
		foreground: t.fg ?? undefined,
		cursor: t.cursor ?? t.fg ?? undefined,
		cursorAccent: t.cursorText ?? t.bg ?? undefined,
		selectionBackground: sel,
		selectionForeground: t.selectionFg ?? undefined,
	};
	names.forEach((n, i) => (out[n] = t.ansi16[i] ?? undefined));
	return out;
}

/** Syntax token color/style by role (`keyword`, `string`, `function`, …). */
export interface SyntaxToken {
	color?: string;
	italic?: boolean;
	weight?: string;
}

export function syntaxTokens(style: ThemeStyle): Record<string, SyntaxToken> {
	const out: Record<string, SyntaxToken> = {};
	for (const [key, s] of Object.entries(style.syntax ?? {})) {
		if (!s || typeof s !== "object") continue;
		const tok: SyntaxToken = {};
		const c = color((s as SyntaxStyle).color);
		if (c) tok.color = c;
		if (s.font_style === "italic") tok.italic = true;
		if (typeof s.font_weight === "number") tok.weight = String(s.font_weight);
		if (Object.keys(tok).length) out[key] = tok;
	}
	return out;
}

/** Whether `appearance` is a valid appearance value. */
export const isAppearance = (v: unknown): v is Appearance => v === "dark" || v === "light";
