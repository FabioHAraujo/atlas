/**
 * Typed theme schema, file validation and selection migration. Pure: no Svelte, no IPC.
 * File format: Zed theme family JSON (https://zed.dev/schema/themes/v0.2.0.json) plus an optional
 * per-theme `atlas` block (`version`, suggested terminal `font`). See `tokens.ts` for the keys.
 */
import { color } from "#lib/theme/color.ts";
import { ANSI_KEYS, EDITOR_TOKENS, SYNTAX_ROLES, TERMINAL_KEYS, UI_TOKENS } from "#lib/theme/tokens.ts";

export type Appearance = "dark" | "light";

/** Version of the `atlas` block this build writes and understands. */
export const THEME_VERSION = 1;

export interface SyntaxStyle {
	color?: string | null;
	font_style?: string | null;
	font_weight?: number | null;
}

export interface ThemeStyle {
	syntax?: Record<string, SyntaxStyle>;
	players?: { cursor?: string; selection?: string }[];
	[key: string]: unknown;
}

/** Suggested terminal font carried by a theme (applied by the import flow, never by selecting it). */
export interface ThemeFont {
	family?: string;
	size?: number;
	thicken?: boolean;
}

export interface Theme {
	name: string;
	appearance: Appearance;
	style: ThemeStyle;
	font?: ThemeFont;
	source: "bundled" | "user";
	/** Path of the user file (`~/.atlas/themes/x.json`), for removal and error reports. */
	file?: string;
	/** Family name of the JSON file the theme came from. */
	family: string;
}

export interface Issue {
	path: string;
	level: "error" | "warn";
	message: string;
}

export interface ThemeSelection {
	v: 2;
	mode: "system" | "light" | "dark";
	light: string;
	dark: string;
	/** `app` = the terminal uses the app theme; otherwise the name of any theme. */
	terminal: string;
}

export const DEFAULT_SELECTION: ThemeSelection = {
	v: 2,
	mode: "system",
	light: "Atlas Light",
	dark: "Atlas Dark",
	terminal: "app",
};

/** What shipped before v2 selections: a stored selection equal to this was never a deliberate choice. */
const LEGACY_DEFAULT = { mode: "system", light: "Atlas Light", dark: "Atlas Dark" };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Every style key the schema knows (anything else is kept but warned about). */
const KNOWN_KEYS: Record<string, true> = Object.fromEntries(
	[
		...Object.keys(UI_TOKENS),
		...Object.keys(EDITOR_TOKENS),
		...TERMINAL_KEYS,
		...ANSI_KEYS,
		"players",
		"syntax",
	].map((k) => [k, true] as const),
);

const known = (k: string) => k in KNOWN_KEYS;

/** Check one style block; every problem names its JSON path. Nothing is thrown. */
export function validateStyle(style: unknown, at: string): Issue[] {
	if (!isObj(style)) return [{ path: at, level: "error", message: "`style` must be an object" }];
	const out: Issue[] = [];
	for (const [k, v] of Object.entries(style)) {
		if (k === "syntax") {
			if (!isObj(v))
				out.push({ path: `${at}.syntax`, level: "error", message: "`syntax` must be an object" });
			else out.push(...validateSyntax(v, `${at}.syntax`));
		} else if (k === "players") {
			const p = Array.isArray(v) ? v[0] : undefined;
			if (!isObj(p))
				out.push({
					path: `${at}.players`,
					level: "warn",
					message: "expected an array with a cursor/selection object",
				});
			else
				for (const f of ["cursor", "selection"])
					if (p[f] !== undefined && !color(p[f]))
						out.push({
							path: `${at}.players[0].${f}`,
							level: "warn",
							message: `"${String(p[f])}" is not #rrggbb or #rrggbbaa`,
						});
		} else if (typeof v === "string" || v === null) {
			if (v !== null && !color(v))
				out.push({
					path: `${at}.${k}`,
					level: "warn",
					message: `"${v}" is not #rrggbb or #rrggbbaa; ignored`,
				});
			if (!known(k)) out.push({ path: `${at}.${k}`, level: "warn", message: "unknown key; ignored" });
		} else if (!known(k)) out.push({ path: `${at}.${k}`, level: "warn", message: "unknown key; ignored" });
	}
	return out;
}

function validateSyntax(syntax: Record<string, unknown>, at: string): Issue[] {
	const roles: Record<string, true> = Object.fromEntries(SYNTAX_ROLES.map((r) => [r, true] as const));
	const out: Issue[] = [];
	for (const [role, s] of Object.entries(syntax)) {
		if (!isObj(s)) {
			out.push({
				path: `${at}.${role}`,
				level: "warn",
				message: "expected { color, font_style, font_weight }",
			});
			continue;
		}
		if (s.color != null && !color(s.color))
			out.push({
				path: `${at}.${role}.color`,
				level: "warn",
				message: `"${String(s.color)}" is not #rrggbb or #rrggbbaa; ignored`,
			});
		if (s.font_style != null && s.font_style !== "italic" && s.font_style !== "normal")
			out.push({
				path: `${at}.${role}.font_style`,
				level: "warn",
				message: 'expected "italic", "normal" or null',
			});
		if (
			s.font_weight != null &&
			!(typeof s.font_weight === "number" && s.font_weight >= 100 && s.font_weight <= 900)
		)
			out.push({
				path: `${at}.${role}.font_weight`,
				level: "warn",
				message: "expected a number from 100 to 900",
			});
		if (!(role in roles))
			out.push({
				path: `${at}.${role}`,
				level: "warn",
				message: "syntax role the editor does not use; ignored",
			});
	}
	return out;
}

function parseFont(v: unknown, at: string, issues: Issue[]): ThemeFont | undefined {
	if (v === undefined) return;
	if (!isObj(v)) {
		issues.push({ path: at, level: "warn", message: "`font` must be an object" });
		return;
	}
	const font: ThemeFont = {};
	if (typeof v.family === "string" && v.family.trim()) font.family = v.family.trim();
	if (typeof v.size === "number" && v.size >= 6 && v.size <= 48) font.size = v.size;
	else if (v.size !== undefined)
		issues.push({ path: `${at}.size`, level: "warn", message: "expected a number from 6 to 48" });
	if (typeof v.thicken === "boolean") font.thicken = v.thicken;
	return font;
}

export interface ParsedFamily {
	themes: Omit<Theme, "source" | "file">[];
	issues: Issue[];
}

/**
 * A theme family file → themes + issues. A broken member is skipped with an error naming it, so
 * one bad theme never hides the rest; a structurally invalid file yields an error and no themes.
 */
export function parseFamily(json: unknown): ParsedFamily {
	const issues: Issue[] = [];
	if (!isObj(json))
		return {
			themes: [],
			issues: [{ path: "$", level: "error", message: "a theme file must be a JSON object" }],
		};
	if (!Array.isArray(json.themes))
		return { themes: [], issues: [{ path: "$.themes", level: "error", message: 'needs a "themes" array' }] };
	const family = typeof json.name === "string" && json.name ? json.name : "Untitled";
	const themes: ParsedFamily["themes"] = [];
	json.themes.forEach((t: unknown, i: number) => {
		const at = `$.themes[${i}]`;
		if (!isObj(t)) return issues.push({ path: at, level: "error", message: "theme must be an object" });
		if (typeof t.name !== "string" || !t.name.trim())
			return issues.push({
				path: `${at}.name`,
				level: "error",
				message: 'needs a non-empty "name"; theme skipped',
			});
		if (t.appearance !== "dark" && t.appearance !== "light")
			return issues.push({
				path: `${at}.appearance`,
				level: "error",
				message: `"${t.name}": appearance must be "dark" or "light"; theme skipped`,
			});
		if (!isObj(t.style))
			return issues.push({
				path: `${at}.style`,
				level: "error",
				message: `"${t.name}": needs a "style" object; theme skipped`,
			});
		const meta = isObj(t.atlas) ? t.atlas : undefined;
		if (meta && typeof meta.version === "number" && meta.version > THEME_VERSION)
			issues.push({
				path: `${at}.atlas.version`,
				level: "warn",
				message: `written by a newer Atlas (v${meta.version}); unknown keys are ignored`,
			});
		issues.push(...validateStyle(t.style, `${at}.style`));
		const font = parseFont(meta?.font, `${at}.atlas.font`, issues);
		themes.push({
			name: t.name.trim(),
			appearance: t.appearance,
			style: t.style as ThemeStyle,
			font,
			family,
		});
	});
	return { themes, issues };
}

/**
 * Stored `theme` setting → selection, and whether the user chose it deliberately. Absent, invalid
 * or a pre-v2 file naming the Atlas pair (never deliberate) → current defaults; anything else → kept.
 * A v2 selection is only ever written by `setTheme`, so it is always a choice (a Dracula user stays on Dracula).
 */
export function migrateSelection(raw: unknown): { selection: ThemeSelection; explicit: boolean } {
	const def = { selection: { ...DEFAULT_SELECTION }, explicit: false };
	if (!isObj(raw) || Object.keys(raw).length === 0) return def;
	const sel = { ...DEFAULT_SELECTION };
	if (raw.mode === "light" || raw.mode === "dark" || raw.mode === "system") sel.mode = raw.mode;
	if (typeof raw.light === "string" && raw.light) sel.light = raw.light;
	if (typeof raw.dark === "string" && raw.dark) sel.dark = raw.dark;
	if (typeof raw.terminal === "string" && raw.terminal) sel.terminal = raw.terminal;
	if (raw.v === undefined) {
		const legacy = { mode: raw.mode, light: raw.light, dark: raw.dark };
		const same = Object.entries(LEGACY_DEFAULT).every(([k, v]) => legacy[k as keyof typeof legacy] === v);
		const bare = Object.keys(raw).every((k) => k in LEGACY_DEFAULT);
		if (same && bare) return def;
		// A legacy file that only set some fields: the missing ones were the old defaults, not the new.
		if (raw.light === undefined) sel.light = LEGACY_DEFAULT.light;
		if (raw.dark === undefined) sel.dark = LEGACY_DEFAULT.dark;
		if (raw.mode === undefined) sel.mode = "system";
	}
	return { selection: sel, explicit: true };
}

/** The theme to use: the named one of the active appearance, else the default of that appearance, else any. */
export function resolveTheme<T extends { name: string; appearance: Appearance }>(
	themes: T[],
	sel: Pick<ThemeSelection, "mode" | "light" | "dark">,
	systemDark: boolean,
): T | undefined {
	const appearance: Appearance = sel.mode === "system" ? (systemDark ? "dark" : "light") : sel.mode;
	return (
		themes.find((t) => t.name === sel[appearance] && t.appearance === appearance) ??
		themes.find((t) => t.name === DEFAULT_SELECTION[appearance] && t.appearance === appearance) ??
		themes.find((t) => t.appearance === appearance)
	);
}

/**
 * The terminal's theme: `app` or a name that no longer exists (a removed or never-installed theme,
 * e.g. a paid one a shared settings file names) both mean "same as the app theme", silently.
 */
export function resolveTerminalTheme<T extends { name: string }>(
	themes: T[],
	terminal: string,
	app: T | undefined,
): T | undefined {
	if (terminal === "app") return app;
	return themes.find((t) => t.name === terminal) ?? app;
}
