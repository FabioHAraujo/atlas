/** tsconfig: the `extends` chain resolved into effective compiler options, each with its doc line. */
import { asRecord, asString, asStringArray, parseData } from "#lib/viewers/rich/data.ts";

export interface TsLayer {
	/** Path relative to the worktree (or the package specifier when it lives in node_modules). */
	path: string;
	options: Record<string, unknown>;
	missing: boolean;
}

export interface TsConfigModel {
	/** Base-first. The last layer is the file itself. */
	chain: TsLayer[];
	options: { key: string; value: unknown; from: string }[];
	include: string[];
	exclude: string[];
	files: string[];
	references: string[];
	error: string | null;
}

/** Short docs for the options people actually look up. */
export const TS_DOCS: Record<string, string> = {
	target: "ECMAScript version the output is emitted for",
	module: "Module system of the emitted code",
	moduleResolution: "How imports are resolved to files",
	lib: "Built-in type declarations that are available",
	jsx: "How JSX is emitted",
	strict: "Enable all strict type-checking options",
	noEmit: "Type-check only, write no files",
	outDir: "Directory emitted files go to",
	rootDir: "Root of the input files",
	baseUrl: "Base directory for non-relative imports",
	paths: "Import aliases mapped to locations",
	esModuleInterop: "Interop between CommonJS and ES modules",
	skipLibCheck: "Skip type-checking .d.ts files",
	declaration: "Emit .d.ts files",
	sourceMap: "Emit source maps",
	resolveJsonModule: "Allow importing .json files",
	isolatedModules: "Require every file to be transpilable on its own",
	allowJs: "Allow JavaScript files in the program",
	checkJs: "Report errors in JavaScript files",
	incremental: "Reuse the previous build's info",
	composite: "Enable project references",
	types: "Only these @types packages are included",
	noUncheckedIndexedAccess: "Index access adds `undefined` to the type",
	verbatimModuleSyntax: "Keep imports/exports exactly as written",
	allowImportingTsExtensions: "Allow importing .ts files with their extension",
	forceConsistentCasingInFileNames: "Error on inconsistent file-name casing",
	useDefineForClassFields: "Emit class fields with define semantics",
	experimentalDecorators: "Enable legacy decorators",
	noImplicitAny: "Error on expressions typed implicitly as any",
};

/**
 * Resolve the chain starting at `path`. `read` returns a file's text or null; `resolve` turns an `extends`
 * specifier into a candidate path (relative to the file, or into node_modules).
 */
export async function resolveTsconfig(
	path: string,
	read: (path: string) => Promise<string | null>,
	resolve: (from: string, spec: string) => string[],
): Promise<TsConfigModel> {
	const chain: TsLayer[] = [];
	const seen = new Set<string>();
	let include: string[] = [];
	let exclude: string[] = [];
	let files: string[] = [];
	let references: string[] = [];
	let error: string | null = null;
	let cur: string | null = path;
	let first = true;
	while (cur && !seen.has(cur) && chain.length < 12) {
		seen.add(cur);
		const text: string | null = await read(cur);
		if (text === null) {
			chain.unshift({ path: cur, options: {}, missing: true });
			break;
		}
		const parsed = parseData(text, "json");
		if (!parsed.ok) {
			if (first) error = parsed.error;
			chain.unshift({ path: cur, options: {}, missing: false });
			break;
		}
		const r = asRecord(parsed.value);
		chain.unshift({ path: cur, options: asRecord(r.compilerOptions), missing: false });
		if (first) {
			include = asStringArray(r.include);
			exclude = asStringArray(r.exclude);
			files = asStringArray(r.files);
			references = (Array.isArray(r.references) ? r.references : [])
				.map((x) => asString(asRecord(x).path) ?? "")
				.filter(Boolean);
		}
		first = false;
		const ext = Array.isArray(r.extends) ? asString(r.extends[r.extends.length - 1]) : asString(r.extends);
		cur = null;
		if (ext) {
			for (const cand of resolve(chain[0].path, ext)) {
				if ((await read(cand)) !== null) {
					cur = cand;
					break;
				}
			}
			if (!cur) chain.unshift({ path: ext, options: {}, missing: true });
		}
	}
	const merged = new Map<string, { value: unknown; from: string }>();
	for (const l of chain)
		for (const [k, v] of Object.entries(l.options)) merged.set(k, { value: v, from: l.path });
	return {
		chain,
		options: [...merged].map(([key, x]) => ({ key, ...x })).sort((a, b) => a.key.localeCompare(b.key)),
		include,
		exclude,
		files,
		references,
		error,
	};
}

/** Candidate paths for `extends: spec` from `from` (a worktree-relative path). */
export function extendsCandidates(from: string, spec: string): string[] {
	const dir = from.split("/").slice(0, -1);
	const join = (base: string[], rel: string) => {
		const out = [...base];
		for (const seg of rel.split("/")) {
			if (seg === "..") out.pop();
			else if (seg !== "." && seg) out.push(seg);
		}
		return out.join("/");
	};
	if (spec.startsWith(".")) {
		const p = join(dir, spec);
		return p.endsWith(".json") ? [p] : [`${p}.json`, `${p}/tsconfig.json`];
	}
	const up: string[] = [];
	const cands: string[] = [];
	for (let d = [...dir]; ; d.pop()) {
		const nm = [...d, "node_modules", spec].join("/");
		cands.push(nm.endsWith(".json") ? nm : `${nm}.json`, `${nm}/tsconfig.json`);
		if (!d.length) break;
	}
	return [...up, ...cands];
}
