/**
 * Built-in "Format document" for files no language server formats. JSON is done in-house
 * (stable key order, no dependency); web formats lazy-load `prettier/standalone` plus the one
 * plugin they need, so nothing is paid until the user formats (core ~27 KB gz, plugins 44–215 KB gz).
 */
import type { Plugin } from "prettier";
import { stripJsonc } from "#lib/viewers/rich/data.ts";

export interface FormatStyle {
	/** `"\t"` or N spaces, from `.editorconfig` / the editor's indent unit. */
	indent: string;
	/** Final newline (editorconfig `insert_final_newline`), default true. */
	finalNewline: boolean;
}
// The `import()`s below are deliberate code-splitting: each Prettier plugin is its own chunk that
// must stay out of the startup bundle, so a static import cannot work.

const PARSERS: Record<string, { parser: string; plugins: () => Promise<Plugin[]> }> = {
	css: { parser: "css", plugins: () => Promise.all([import("prettier/plugins/postcss")]) },
	scss: { parser: "scss", plugins: () => Promise.all([import("prettier/plugins/postcss")]) },
	less: { parser: "less", plugins: () => Promise.all([import("prettier/plugins/postcss")]) },
	html: { parser: "html", plugins: () => Promise.all([import("prettier/plugins/html")]) },
	vue: { parser: "vue", plugins: () => Promise.all([import("prettier/plugins/html")]) },
	yaml: { parser: "yaml", plugins: () => Promise.all([import("prettier/plugins/yaml")]) },
	markdown: { parser: "markdown", plugins: () => Promise.all([import("prettier/plugins/markdown")]) },
	javascript: {
		parser: "babel",
		plugins: () => Promise.all([import("prettier/plugins/babel"), import("prettier/plugins/estree")]),
	},
	jsx: {
		parser: "babel",
		plugins: () => Promise.all([import("prettier/plugins/babel"), import("prettier/plugins/estree")]),
	},
	typescript: {
		parser: "typescript",
		plugins: () => Promise.all([import("prettier/plugins/typescript"), import("prettier/plugins/estree")]),
	},
	tsx: {
		parser: "typescript",
		plugins: () => Promise.all([import("prettier/plugins/typescript"), import("prettier/plugins/estree")]),
	},
	graphql: { parser: "graphql", plugins: () => Promise.all([import("prettier/plugins/graphql")]) },
};

/** Whether `formatText` can handle this language id. */
export const canFormat = (lang: string | null) =>
	lang === "json" || lang === "jsonc" || (!!lang && lang in PARSERS);

/** Pretty-print JSON; throws SyntaxError with the parser's message when invalid. JSONC files keep their comments through Prettier instead. */
export function formatJson(text: string, style: FormatStyle): string {
	const out = JSON.stringify(JSON.parse(stripJsonc(text)), null, style.indent);
	return style.finalNewline ? out + "\n" : out;
}

/** Formatted text, or `null` when there is no built-in formatter for the language. Throws on a syntax error. */
export async function formatText(
	text: string,
	lang: string | null,
	style: FormatStyle,
): Promise<string | null> {
	if (lang === "json") return formatJson(text, style);
	const p = lang ? PARSERS[lang] : undefined;
	if (lang === "jsonc") {
		const prettier = await import("prettier/standalone");
		return prettier.format(text, {
			parser: "json",
			plugins: await Promise.all([import("prettier/plugins/babel"), import("prettier/plugins/estree")]),
			...prettierIndent(style),
		});
	}
	if (!p) return null;
	const prettier = await import("prettier/standalone");
	const out = await prettier.format(text, {
		parser: p.parser,
		plugins: await p.plugins(),
		...prettierIndent(style),
	});
	return style.finalNewline ? out : out.replace(/\n$/, "");
}

function prettierIndent(style: FormatStyle) {
	return style.indent === "\t" ? { useTabs: true } : { useTabs: false, tabWidth: style.indent.length };
}

/** Subset of `.editorconfig` that formatting needs, for one file path. */
export function editorConfigFor(
	files: { dir: string; text: string }[],
	path: string,
): { indent: string | null; finalNewline: boolean | null } {
	let indentStyle: string | null = null;
	let size: number | null = null;
	let finalNewline: boolean | null = null;
	// Closest file wins: callers pass them root-first, so later entries override.
	for (const f of files) {
		const rel = f.dir ? path.slice(f.dir.length + 1) : path;
		let active = false;
		for (const raw of f.text.split("\n")) {
			const l = raw.trim();
			if (!l || l.startsWith("#") || l.startsWith(";")) continue;
			const sec = /^\[(.+)\]$/.exec(l);
			if (sec) {
				active = globMatches(sec[1], rel);
				continue;
			}
			if (!active) continue;
			const [k, v = ""] = l.split("=").map((s) => s.trim().toLowerCase());
			if (k === "indent_style") indentStyle = v === "unset" ? null : v;
			if (k === "indent_size" || k === "tab_width") size = /^\d+$/.test(v) ? Number(v) : size;
			if (k === "insert_final_newline")
				finalNewline = v === "true" ? true : v === "false" ? false : finalNewline;
		}
	}
	const indent =
		indentStyle === "tab" ? "\t" : indentStyle === "space" || size ? " ".repeat(size ?? 2) : null;
	return { indent, finalNewline };
}

/** `*`, `**`, `?`, `{a,b}` and `[abc]` globs as in `.editorconfig` (a pattern without `/` matches at any depth). */
export function globMatches(glob: string, rel: string): boolean {
	let re = "";
	for (let i = 0; i < glob.length; i++) {
		const c = glob[i];
		if (c === "*") {
			if (glob[i + 1] === "*") {
				re += ".*";
				i++;
			} else re += "[^/]*";
		} else if (c === "?") re += "[^/]";
		else if (c === "{") {
			const end = glob.indexOf("}", i);
			if (end < 0) re += "\\{";
			else {
				re += `(?:${glob
					.slice(i + 1, end)
					.split(",")
					.map((s) => s.replace(/[.+^$()|\\]/g, "\\$&"))
					.join("|")})`;
				i = end;
			}
		} else if (c === "[") {
			const end = glob.indexOf("]", i);
			if (end < 0) re += "\\[";
			else {
				re += glob.slice(i, end + 1);
				i = end;
			}
		} else re += c.replace(/[.+^$()|\\/]/g, "\\$&");
	}
	return new RegExp(glob.includes("/") ? `^${re}$` : `(^|/)${re}$`).test(rel);
}
