/**
 * What an editor session decides from a file's text and its `.editorconfig`: the text the view
 * shows (always `\n`), the line ending to write back, the indentation, the large-file tier and the
 * save policy. Pure: the component feeds it text and prefs and applies the answer to the view.
 */
import { detectEol, detectIndent, applySavePolicy, type Eol, type IndentStyle } from "#lib/editor/detect.ts";
import { resolveEditorConfig, type EditorConfigProps } from "#lib/editor/editorconfig.ts";
import { classifyFile, type Classification } from "#lib/editor/largeFile.ts";
import type { EditorPrefs } from "#lib/editor/settings.ts";

export interface Indent {
	style: IndentStyle;
	size: number;
	/** Came from the file's own content (not `.editorconfig` or the preference). */
	detected: boolean;
}

export interface OpenPlan {
	/** Document text for the view: every line ending is `\n`. */
	text: string;
	/** Line ending to write back on save. `mixed` files are written as `lf`. */
	eol: Eol;
	/** The file mixed line endings (shown as a warning; saving normalises them). */
	mixedEol: boolean;
	indent: Indent;
	config: EditorConfigProps;
	large: Classification;
	save: { trim: boolean; finalNewline: boolean };
}

/** Longest line of `text` in UTF-16 units, one pass without splitting (a 5 MB one-liner allocates nothing). */
export function longestLine(text: string): number {
	let longest = 0;
	let start = 0;
	for (;;) {
		const nl = text.indexOf("\n", start);
		const end = nl === -1 ? text.length : nl;
		if (end - start > longest) longest = end - start;
		if (nl === -1) return longest;
		start = nl + 1;
	}
}

/** `\r\n` and lone `\r` become `\n`; the view never holds anything else. */
export function toViewText(text: string): string {
	return text.includes("\r") ? text.replace(/\r\n?/g, "\n") : text;
}

function lineCount(text: string): number {
	let n = 1;
	for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) n++;
	return n;
}

/**
 * Plan for a file just read from disk. `bytes` is the on-disk size, `files` the `.editorconfig`
 * files found above the file (see `editorConfigDirs`); `path` is the same base as their `dir`.
 */
export function planOpen(args: {
	raw: string;
	bytes: number;
	path: string;
	files: { dir: string; text: string }[];
	prefs: EditorPrefs;
}): OpenPlan {
	const { raw, bytes, path, files, prefs } = args;
	const config = resolveEditorConfig(path, files);
	const detectedEol = detectEol(raw);
	const text = toViewText(raw);
	const large = classifyFile(
		{ bytes, lines: lineCount(text), longestLine: longestLine(text) },
		{ largeBytes: prefs.large_file_threshold_bytes },
	);
	const eol: Eol = config.end_of_line ?? (detectedEol === "mixed" ? "lf" : detectedEol);

	const fromConfig: Indent | null = config.indent_style
		? {
				style: config.indent_style,
				size:
					config.indent_style === "tab"
						? (config.tab_width ?? prefs.tab_size)
						: typeof config.indent_size === "number"
							? config.indent_size
							: prefs.tab_size,
				detected: false,
			}
		: null;
	let indent: Indent;
	if (fromConfig) indent = fromConfig;
	else if (large.tier !== "normal") {
		// Sampling a huge file for its indentation is not worth the time; the preference decides.
		indent = { style: prefs.insert_spaces ? "space" : "tab", size: prefs.tab_size, detected: false };
	} else {
		const d = detectIndent(text, { style: prefs.insert_spaces ? "space" : "tab", size: prefs.tab_size });
		const hasEvidence = d.style !== (prefs.insert_spaces ? "space" : "tab") || d.size !== prefs.tab_size;
		indent = { ...d, detected: hasEvidence };
	}

	return {
		text,
		eol,
		mixedEol: detectedEol === "mixed",
		indent,
		config,
		large,
		save: {
			trim: config.trim_trailing_whitespace ?? prefs.trim_trailing_whitespace_on_save,
			finalNewline: config.insert_final_newline ?? prefs.insert_final_newline_on_save,
		},
	};
}

/**
 * The bytes to write for the view's `text`: save policy and line ending applied. This is also what
 * `lastSaved` holds, so a file the user has not touched compares equal to its on-disk text.
 */
export function planSave(text: string, plan: Pick<OpenPlan, "eol" | "save">): string {
	return applySavePolicy(text, { trim: plan.save.trim, finalNewline: plan.save.finalNewline, eol: plan.eol });
}
