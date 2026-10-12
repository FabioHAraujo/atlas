/**
 * `.editorconfig` support, pure: parse the text, compile section globs, and resolve the
 * properties of a file from the `.editorconfig` files found on the way up to the root. The caller
 * reads the files (`editorConfigDirs` says which) through the host fs.
 */

export interface EditorConfigProps {
	indent_style?: "space" | "tab";
	indent_size?: number | "tab";
	tab_width?: number;
	end_of_line?: "lf" | "crlf" | "cr";
	charset?: string;
	trim_trailing_whitespace?: boolean;
	insert_final_newline?: boolean;
	max_line_length?: number;
}

export interface EditorConfigSection {
	glob: string;
	/** Lower-cased keys and values as written; `unset` is kept for the resolver. */
	props: Record<string, string>;
}

export interface ParsedEditorConfig {
	root: boolean;
	sections: EditorConfigSection[];
}

/** Parse `.editorconfig` text: `root = true` in the preamble, `[glob]` sections of `key = value`. */
export function parseEditorConfig(text: string): ParsedEditorConfig {
	const out: ParsedEditorConfig = { root: false, sections: [] };
	let current: EditorConfigSection | null = null;
	for (const raw of text.split(/\r\n|\r|\n/)) {
		const line = raw.trim();
		if (line === "" || line[0] === "#" || line[0] === ";") continue;
		if (line[0] === "[") {
			const end = line.lastIndexOf("]");
			if (end < 1) continue;
			current = { glob: line.slice(1, end), props: {} };
			out.sections.push(current);
			continue;
		}
		const eq = line.indexOf("=");
		if (eq < 1) continue;
		const key = line.slice(0, eq).trim().toLowerCase();
		const value = line.slice(eq + 1).trim();
		if (current) current.props[key] = value;
		else if (key === "root") out.root = value.toLowerCase() === "true";
	}
	return out;
}

const escapeRe = (c: string) => c.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/** Index of the `}` closing the `{` at `open`, or -1 (nesting-aware, honours `\` escapes). */
function closingBrace(g: string, open: number): number {
	let depth = 0;
	for (let i = open; i < g.length; i++) {
		if (g[i] === "\\") i++;
		else if (g[i] === "{") depth++;
		else if (g[i] === "}" && --depth === 0) return i;
	}
	return -1;
}

/** Split brace content on top-level commas. */
function splitAlternatives(body: string): string[] {
	const parts: string[] = [];
	let depth = 0;
	let from = 0;
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if (c === "\\") i++;
		else if (c === "{") depth++;
		else if (c === "}") depth--;
		else if (c === "," && depth === 0) {
			parts.push(body.slice(from, i));
			from = i + 1;
		}
	}
	parts.push(body.slice(from));
	return parts;
}

/** Translate an EditorConfig glob to regex source (no anchors). */
function globSource(g: string): string {
	let re = "";
	for (let i = 0; i < g.length; i++) {
		const c = g[i];
		if (c === "\\" && i + 1 < g.length) re += escapeRe(g[++i]);
		else if (c === "*") {
			if (g[i + 1] === "*") {
				re += ".*";
				i++;
			} else re += "[^/]*";
		} else if (c === "?") re += "[^/]";
		else if (c === "[") {
			const end = g.indexOf("]", i + 2);
			if (end === -1) re += "\\[";
			else {
				let set = g.slice(i + 1, end);
				const neg = set[0] === "!";
				if (neg) set = set.slice(1);
				re += `[${neg ? "^" : ""}${set.replace(/[\\\]^]/g, "\\$&")}]`;
				i = end;
			}
		} else if (c === "{") {
			const end = closingBrace(g, i);
			if (end === -1) re += "\\{";
			else {
				const body = g.slice(i + 1, end);
				const range = /^([+-]?\d+)\.\.([+-]?\d+)$/.exec(body);
				if (range) re += `(?:${numRange(Number(range[1]), Number(range[2]))})`;
				else {
					const alts = splitAlternatives(body);
					// `{single}` is literal braces; `{a,b}` is alternation.
					if (alts.length === 1) re += `\\{${globSource(body)}\\}`;
					else re += `(?:${alts.map(globSource).join("|")})`;
				}
				i = end;
			}
		} else re += escapeRe(c);
	}
	return re;
}

/** Alternation of the integers between `a` and `b` (either order); bounded to keep patterns small. */
function numRange(a: number, b: number): string {
	const [lo, hi] = a <= b ? [a, b] : [b, a];
	if (hi - lo > 10_000) return "[+-]?\\d+";
	const nums: string[] = [];
	for (let n = lo; n <= hi; n++) nums.push(String(n));
	return nums.join("|");
}

/**
 * Compile one section glob. Per the spec, a glob without `/` matches the file name at any depth
 * (`*.ts`, `Makefile`); one containing `/` is relative to the `.editorconfig` directory (a leading
 * `/` is allowed and ignored). Matching is against a path relative to that directory.
 */
export function compileGlob(glob: string): RegExp {
	const anchored = glob.includes("/");
	const g = glob.startsWith("/") ? glob.slice(1) : glob;
	return new RegExp(`^${anchored ? "" : "(?:.*/)?"}${globSource(g)}$`);
}

const CACHE = new Map<string, RegExp>();
function cachedGlob(glob: string): RegExp {
	let re = CACHE.get(glob);
	if (!re) {
		re = compileGlob(glob);
		if (CACHE.size > 500) CACHE.clear();
		CACHE.set(glob, re);
	}
	return re;
}

/** Whether `glob` (a section header) matches `relPath`, a `/`-separated path under the config's dir. */
export function matchesGlob(glob: string, relPath: string): boolean {
	return cachedGlob(glob).test(relPath);
}

const INDENT_STYLES = ["space", "tab"] as const;
const EOLS = ["lf", "crlf", "cr"] as const;

/** Typed properties from raw section values; `unset` (and invalid values) remove the key. */
function applyProps(into: Record<string, unknown>, raw: Record<string, string>): void {
	for (const [key, rawValue] of Object.entries(raw)) {
		const v = rawValue.toLowerCase();
		if (v === "unset") {
			delete into[key];
			continue;
		}
		const num = /^\d+$/.test(v) ? Number(v) : null;
		switch (key) {
			case "indent_style":
				if (INDENT_STYLES.some((s) => s === v)) into[key] = v;
				break;
			case "indent_size":
				if (v === "tab") into[key] = "tab";
				else if (num !== null && num > 0) into[key] = num;
				break;
			case "tab_width":
			case "max_line_length":
				if (num !== null && num > 0) into[key] = num;
				else if (key === "max_line_length" && v === "off") delete into[key];
				break;
			case "end_of_line":
				if (EOLS.some((s) => s === v)) into[key] = v;
				break;
			case "charset":
				into[key] = v;
				break;
			case "trim_trailing_whitespace":
			case "insert_final_newline":
				if (v === "true" || v === "false") into[key] = v === "true";
				break;
		}
	}
}

const joinPath = (...parts: string[]) => parts.filter((p) => p !== "").join("/");

/** `dir` relative to `base` (`/`-separated, no trailing slash); `base` itself is `""`. */
function relativeTo(base: string, path: string): string | null {
	const b = base.replace(/\/+$/, "");
	if (b === "") return path.replace(/^\/+/, "");
	if (path === b) return "";
	return path.startsWith(`${b}/`) ? path.slice(b.length + 1) : null;
}

/**
 * Candidate directories whose `.editorconfig` may apply to `path`, nearest first, from the file's
 * own directory up to and including `rootDir` (a worktree root; the search never leaves it).
 * Both arguments use `/`; `path` is absolute or relative to the same base as `rootDir`.
 */
export function editorConfigDirs(path: string, rootDir: string): string[] {
	const root = rootDir.replace(/\/+$/, "");
	const rel = relativeTo(root, path);
	if (rel === null) return [];
	const parts = rel.split("/").filter((p) => p !== "");
	parts.pop(); // the file name
	const dirs: string[] = [];
	for (let n = parts.length; n >= 0; n--)
		dirs.push(root === "" && n === 0 ? "" : joinPath(root, ...parts.slice(0, n)));
	return dirs;
}

/**
 * Properties for `path` from the loaded `.editorconfig` files (`dir` is each file's directory,
 * same base as `path`). Files nearer the file win; one with `root = true` ends the search, so
 * everything above it is ignored. Within a file the last matching section wins per key.
 */
export function resolveEditorConfig(path: string, files: { dir: string; text: string }[]): EditorConfigProps {
	// Deepest directory first; ties (should not happen) keep input order.
	const ordered = files
		.map((f) => ({ ...f, dir: f.dir.replace(/\/+$/, "") }))
		.sort((a, b) => b.dir.length - a.dir.length);
	const chain: { dir: string; parsed: ParsedEditorConfig }[] = [];
	for (const f of ordered) {
		if (relativeTo(f.dir, path) === null) continue; // not an ancestor of the file
		const parsed = parseEditorConfig(f.text);
		chain.push({ dir: f.dir, parsed });
		if (parsed.root) break;
	}
	const props: Record<string, unknown> = {};
	// Apply root-most first so nearer files override.
	for (const { dir, parsed } of chain.reverse()) {
		const rel = relativeTo(dir, path);
		if (rel === null) continue;
		for (const section of parsed.sections) {
			if (matchesGlob(section.glob, rel)) applyProps(props, section.props);
		}
	}
	return finish(props as EditorConfigProps);
}

/** Spec defaults: `indent_size = tab` uses tab_width; `tab_width` defaults to a numeric indent_size. */
function finish(p: EditorConfigProps): EditorConfigProps {
	if (p.indent_style === "tab" && p.indent_size === undefined) p.indent_size = "tab";
	if (p.tab_width === undefined && typeof p.indent_size === "number") p.tab_width = p.indent_size;
	if (p.indent_size === "tab" && p.tab_width !== undefined) p.indent_size = p.tab_width;
	return p;
}
