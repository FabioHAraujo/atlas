/** JSON / JSONC / YAML / TOML text → plain value, with the error position when it does not parse. */
import { parse as parseYaml } from "yaml";
import { parse as parseToml } from "smol-toml";

export type DataFormat = "json" | "yaml" | "toml";

export type Parsed = { ok: true; value: unknown } | { ok: false; error: string; line?: number };

/** Strip `//`, `/* *\/` comments and trailing commas outside strings (tsconfig, .eslintrc, VS Code settings). */
export function stripJsonc(text: string): string {
	let out = "";
	let i = 0;
	while (i < text.length) {
		const c = text[i];
		if (c === '"') {
			let j = i + 1;
			while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
			out += text.slice(i, j + 1);
			i = j + 1;
		} else if (c === "/" && text[i + 1] === "/") {
			while (i < text.length && text[i] !== "\n") i++;
		} else if (c === "/" && text[i + 1] === "*") {
			const end = text.indexOf("*/", i + 2);
			i = end < 0 ? text.length : end + 2;
		} else {
			out += c;
			i++;
		}
	}
	return out.replace(/,(\s*[}\]])/g, "$1");
}

export function parseData(text: string, format: DataFormat): Parsed {
	try {
		if (format === "json") return { ok: true, value: JSON.parse(stripJsonc(text)) };
		if (format === "toml") return { ok: true, value: parseToml(text) };
		const doc = parseYaml(text, { merge: true, maxAliasCount: 1000 });
		return { ok: true, value: doc };
	} catch (e) {
		const err = e as { message?: string; linePos?: { line: number }[]; line?: number };
		return {
			ok: false,
			error: (err.message ?? String(e)).split("\n")[0],
			line: err.linePos?.[0]?.line ?? err.line,
		};
	}
}

/** Format guessed from a file name (the editor's `fileType().lang`). */
export function formatOf(lang: string | null): DataFormat {
	return lang === "yaml" ? "yaml" : lang === "toml" ? "toml" : "json";
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);
export const asRecord = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : {});
export const asString = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
export const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
export const asStringArray = (v: unknown): string[] =>
	asArray(v).filter((x): x is string => typeof x === "string");

/** `string | string[] | {k: v}` (compose `command`, `environment`, …) as a flat list of strings. */
export function listOrMap(v: unknown): string[] {
	if (Array.isArray(v)) return v.map((x) => (isRecord(x) ? JSON.stringify(x) : String(x)));
	if (isRecord(v))
		return Object.entries(v).map(([k, x]) => (x === null || x === undefined ? k : `${k}=${String(x)}`));
	return typeof v === "string" ? [v] : [];
}
