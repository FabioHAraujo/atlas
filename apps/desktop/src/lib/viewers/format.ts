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
