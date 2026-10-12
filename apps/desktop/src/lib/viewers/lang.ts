import type { Extension } from "@codemirror/state";
import { StreamLanguage, LanguageDescription, type Language, type StreamParser } from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { rust } from "@codemirror/lang-rust";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { yaml } from "@codemirror/lang-yaml";
import { go } from "@codemirror/lang-go";
import { php } from "@codemirror/lang-php";
import { sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { extOf } from "#lib/viewers/kind.ts";
import { fileType } from "#lib/viewers/fileType.ts";
import {
	envMode,
	gitignoreMode,
	justfileMode,
	makefileMode,
	procfileMode,
	logMode,
} from "#lib/viewers/modes.ts";

/** Fence names that differ from the file extension. */
const ALIAS: Record<string, string> = {
	typescript: "ts",
	javascript: "js",
	python: "py",
	rust: "rs",
	golang: "go",
	yml: "yaml",
	sh: "shell",
	bash: "shell",
	zsh: "shell",
	svg: "xml",
};

/** Languages bundled eagerly: the ones every project has (fences in Markdown need them synchronously). */
function langSupport(nameOrExt: string): Extension {
	const e = nameOrExt.toLowerCase();
	const ext = ALIAS[e] ?? e;
	if (["ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "svelte"].includes(ext))
		return javascript({
			typescript: ext.endsWith("ts") || ext.startsWith("ts") || ext === "svelte",
			jsx: ext.endsWith("x"),
		});
	if (ext === "json" || ext === "jsonc") return json();
	if (ext === "md" || ext === "markdown") return markdown();
	if (ext === "rs") return rust();
	if (ext === "py" || ext === "pyi") return python();
	if (ext === "html" || ext === "htm") return html();
	if (ext === "css" || ext === "scss") return css();
	if (ext === "yaml") return yaml();
	if (ext === "go") return go();
	if (ext === "php") return php();
	if (ext === "sql") return sql();
	if (ext === "xml" || ext === "xsd" || ext === "plist") return xml();
	if (ext === "toml") return StreamLanguage.define(toml);
	if (ext === "shell") return StreamLanguage.define(shell);
	return [];
}

/** Language ids (from `fileType().lang`) that map onto an eagerly bundled language above. */
const EAGER: Record<string, string> = {
	typescript: "ts",
	tsx: "tsx",
	javascript: "js",
	jsx: "jsx",
	json: "json",
	jsonc: "json",
	markdown: "md",
	rust: "rs",
	python: "py",
	html: "html",
	css: "css",
	scss: "css",
	yaml: "yaml",
	go: "go",
	php: "php",
	sql: "sql",
	xml: "xml",
	toml: "toml",
	shell: "shell",
	svelte: "svelte",
};

/** In-house line-based stream modes for the dev files no grammar covers. */
const OWN: Record<string, StreamParser<unknown>> = {
	env: envMode,
	gitignore: gitignoreMode,
	makefile: makefileMode,
	justfile: justfileMode,
	procfile: procfileMode,
	log: logMode,
};

// `import("@codemirror/language-data")` below is deliberate code-splitting: its ~140 grammars are separate
// chunks loaded only when a file needs one, so a static import would put them all in the main bundle.
/** Languages `@codemirror/language-data` names differently from `fileType().lang` (`""` = no grammar, plain text). */
const DATA_NAME: Record<string, string> = {
	cpp: "C++",
	c: "C",
	csharp: "C#",
	"go-mod": "Go",
	vue: "Vue",
	astro: "HTML",
	properties: "Properties files",
	protobuf: "ProtoBuf",
	hcl: "",
	graphql: "",
	prisma: "",
	elixir: "",
	csv: "",
	"go-sum": "",
};

const cache = new Map<string, Promise<Extension>>();

/**
 * Syntax extension for a `fileType().lang`, loading the grammar on demand (legacy-modes and
 * language-data chunks are separate bundle chunks, so rare languages cost nothing until opened).
 */
export function loadLanguage(lang: string | null): Promise<Extension> {
	if (!lang) return Promise.resolve([]);
	const hit = cache.get(lang);
	if (hit) return hit;
	const own = OWN[lang];
	const p: Promise<Extension> = own
		? Promise.resolve(StreamLanguage.define(own))
		: EAGER[lang]
			? Promise.resolve(langSupport(EAGER[lang]))
			: DATA_NAME[lang] === ""
				? Promise.resolve([])
				: import("@codemirror/language-data").then(async ({ languages }) => {
						const name = DATA_NAME[lang] ?? lang;
						const d = LanguageDescription.matchLanguageName(languages, name, true);
						return d ? (await d.load()).extension : [];
					});
	cache.set(lang, p);
	return p;
}

/** Eager extension for a path (extension only): kept for synchronous callers. */
export const langForPath = (path: string) => langSupport(extOf(path));

/** Source-mode language id of a path (`fileType(path).lang`). */
export const langIdForPath = (path: string) => fileType(path).lang;

/** The parser behind a LanguageSupport extension (or StreamLanguage), if any. */
export function languageOf(nameOrExt: string): Language | null {
	const s = langSupport(nameOrExt);
	if (s instanceof StreamLanguage) return s;
	return !Array.isArray(s) && "language" in s ? (s.language as Language) : null;
}

/** LSP `languageId` for a file path (the ids language servers expect), `null` when none applies. */
const LSP_IDS: Record<string, string> = {
	rs: "rust",
	go: "go",
	ts: "typescript",
	mts: "typescript",
	cts: "typescript",
	tsx: "typescriptreact",
	js: "javascript",
	mjs: "javascript",
	cjs: "javascript",
	jsx: "javascriptreact",
	php: "php",
	html: "html",
	htm: "html",
	css: "css",
	scss: "scss",
	json: "json",
	jsonc: "jsonc",
	py: "python",
	pyi: "python",
	yaml: "yaml",
	yml: "yaml",
	sh: "shellscript",
	bash: "shellscript",
	zsh: "shellscript",
};

export const lspLanguageId = (path: string): string | null => LSP_IDS[extOf(path)] ?? null;
