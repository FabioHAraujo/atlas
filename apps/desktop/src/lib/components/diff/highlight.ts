/** Syntax highlighting of diff hunks with shiki, keyed `path#hunkIndex` → tokens per line. */

import { codeToTokens, type BundledLanguage, type ThemedToken } from "shiki";
import { colorScheme } from "@codeatlasdev/ui";
import type { FileDiff } from "#lib/api.ts";

export type { ThemedToken };

const LANG: Record<string, BundledLanguage> = {
	ts: "typescript",
	tsx: "tsx",
	js: "javascript",
	jsx: "jsx",
	svelte: "svelte",
	rs: "rust",
	py: "python",
	json: "json",
	md: "markdown",
	yml: "yaml",
	yaml: "yaml",
	css: "css",
	html: "html",
	sh: "bash",
	toml: "toml",
	go: "go",
	sql: "sql",
};

/** Shiki language for a path, or `undefined` when the extension is not highlighted. */
const langOf = (path: string) => LANG[path.split(".").pop()?.toLowerCase() ?? ""];

/** Highlight each hunk of `f` into `out` (one entry per hunk as it resolves; stops on the first failure). */
export async function highlightFile(f: FileDiff, out: Record<string, ThemedToken[][]>) {
	const lang = langOf(f.path);
	if (!lang || f.binary) return;
	const theme = colorScheme.resolved === "dark" ? "github-dark" : "github-light";
	for (const [i, h] of f.hunks.entries()) {
		const code = h.lines.map((l) => l.text).join("\n");
		try {
			const r = await codeToTokens(code, { lang, theme });
			out[`${f.path}#${i}`] = r.tokens;
		} catch {
			return;
		}
	}
}

export const tokenStyle = (t: ThemedToken) => (t.color ? `color:${t.color}` : "");
