/**
 * The single reader of the editor preferences: `editorPrefs()` is the live `prefs.value.editor`
 * (validated), `resolveEditorPrefs(raw)` the pure part (defaults + validation) so it is testable
 * without Svelte runes and tolerates a settings object written by an older or newer build.
 */
import type { EditorPrefs } from "#lib/prefs.ts";
import { prefs } from "#lib/stores/prefs.svelte.ts";

export type { EditorPrefs };

export const EDITOR_PREF_DEFAULTS: Readonly<EditorPrefs> = {
	tab_size: 4,
	insert_spaces: true,
	word_wrap: false,
	render_whitespace: "none",
	line_numbers: true,
	minimap: false,
	sticky_scroll: true,
	bracket_pair_colorization: true,
	indent_guides: true,
	rulers: [],
	highlight_active_line: true,
	trim_trailing_whitespace_on_save: true,
	insert_final_newline_on_save: true,
	large_file_threshold_bytes: 2_000_000,
	scroll_past_end: true,
	smooth_scrolling: true,
	auto_reload: true,
};

const WHITESPACE = ["none", "selection", "all"] as const;
const MAX_RULER = 500;

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Booleans keep their value, anything else falls back to the default. */
function bool(v: unknown, d: boolean): boolean {
	return typeof v === "boolean" ? v : d;
}

/** A finite number inside [min, max] (non-integers rounded down), else the default. */
function int(v: unknown, d: number, min: number, max: number): number {
	if (typeof v !== "number" || !Number.isFinite(v)) return d;
	const n = Math.floor(v);
	return n >= min && n <= max ? n : d;
}

/** Whole columns 1..500, ascending, without duplicates; anything else is dropped. */
function rulers(v: unknown): number[] {
	if (!Array.isArray(v)) return [];
	const cols = v.filter((n): n is number => Number.isInteger(n) && n >= 1 && n <= MAX_RULER);
	return [...new Set(cols)].sort((a, b) => a - b);
}

/** Validate an untrusted `editor` settings object: bad or missing fields take their default. */
export function resolveEditorPrefs(raw: unknown): EditorPrefs {
	const r = isObj(raw) ? raw : {};
	const d = EDITOR_PREF_DEFAULTS;
	return {
		tab_size: int(r.tab_size, d.tab_size, 1, 16),
		insert_spaces: bool(r.insert_spaces, d.insert_spaces),
		word_wrap: bool(r.word_wrap, d.word_wrap),
		render_whitespace: WHITESPACE.find((w) => w === r.render_whitespace) ?? d.render_whitespace,
		line_numbers: bool(r.line_numbers, d.line_numbers),
		minimap: bool(r.minimap, d.minimap),
		sticky_scroll: bool(r.sticky_scroll, d.sticky_scroll),
		bracket_pair_colorization: bool(r.bracket_pair_colorization, d.bracket_pair_colorization),
		indent_guides: bool(r.indent_guides, d.indent_guides),
		rulers: rulers(r.rulers),
		highlight_active_line: bool(r.highlight_active_line, d.highlight_active_line),
		trim_trailing_whitespace_on_save: bool(
			r.trim_trailing_whitespace_on_save,
			d.trim_trailing_whitespace_on_save,
		),
		insert_final_newline_on_save: bool(r.insert_final_newline_on_save, d.insert_final_newline_on_save),
		large_file_threshold_bytes: int(
			r.large_file_threshold_bytes,
			d.large_file_threshold_bytes,
			100_000,
			100_000_000,
		),
		scroll_past_end: bool(r.scroll_past_end, d.scroll_past_end),
		smooth_scrolling: bool(r.smooth_scrolling, d.smooth_scrolling),
		auto_reload: bool(r.auto_reload, d.auto_reload),
	};
}

/** The current editor preferences (reactive when read inside an effect/derived). */
export function editorPrefs(): EditorPrefs {
	return resolveEditorPrefs(prefs.value.editor);
}
