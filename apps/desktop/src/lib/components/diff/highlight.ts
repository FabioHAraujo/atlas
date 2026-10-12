/** Syntax highlighting of diff hunks with the editor's own lezer highlighter, keyed `path#hunkIndex` → HTML per line. */

import type { FileDiff } from "#lib/api.ts";
import { fileType } from "#lib/viewers/fileType.ts";
import { highlightLines } from "#lib/viewers/rich/highlight.ts";

/** Highlight each hunk of `f` into `out` (one entry per hunk as it resolves; stops on the first failure). */
export async function highlightFile(f: FileDiff, out: Record<string, string[]>) {
	const lang = fileType(f.path).lang;
	if (!lang || f.binary) return;
	for (const [i, h] of f.hunks.entries()) {
		try {
			out[`${f.path}#${i}`] = await highlightLines(h.lines.map((l) => l.text).join("\n"), lang);
		} catch {
			return;
		}
	}
}
