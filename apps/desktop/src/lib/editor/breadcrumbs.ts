/**
 * Breadcrumbs: the file path segments plus the chain of symbols around the caret. Works on LSP
 * `DocumentSymbol` trees (ranges already nested) and on the flat, `from`-ordered Lezer
 * `OutlineSymbol[]` through `nestFlat`. Pure.
 */

export interface Sym {
	name: string;
	kind: string;
	from: number;
	to: number;
	children?: Sym[];
}

/** A flat outline entry (see `OutlineSymbol` in lib/symbols.ts): no end offset. */
export interface FlatSym {
	name: string;
	kind: string;
	from: number;
}

export interface Segment {
	kind: "dir" | "file" | "symbol";
	name: string;
	/** Symbol kind (`Function`, `Class`…); absent on path segments. */
	symbolKind?: string;
	/** Offset to jump to (symbols only). */
	from?: number;
	/** Worktree-relative path up to and including this segment (path segments only). */
	path?: string;
}

/** Heading depth for Markdown outline kinds (`H1`…`H6`), 0 for everything else. */
function headingLevel(s: FlatSym): number {
	const m = /^H([1-6])$/.exec(s.kind);
	return m ? Number(m[1]) : 0;
}

/**
 * Nest a flat outline by containment. Lezer outlines carry no end offset, so a symbol's `to` is
 * where the next symbol at the same or a shallower level starts; the last ends at `docLength`.
 * Levels come from `levelOf`, by default the Markdown heading depth (`H2` is inside `H1`); all
 * other kinds share one level, so each ends where the next begins.
 */
export function nestFlat(
	flat: readonly FlatSym[],
	docLength: number,
	levelOf: (s: FlatSym) => number = headingLevel,
): Sym[] {
	const roots: Sym[] = [];
	const stack: { sym: Sym; level: number }[] = [];
	for (const f of flat) {
		const level = levelOf(f);
		const sym: Sym = { name: f.name, kind: f.kind, from: f.from, to: docLength };
		// Close every open symbol at this level or deeper: it ends where this one starts.
		while (stack.length > 0 && stack[stack.length - 1].level >= level) {
			stack.pop()!.sym.to = f.from;
		}
		const parent = stack[stack.length - 1]?.sym;
		if (parent) (parent.children ??= []).push(sym);
		else roots.push(sym);
		stack.push({ sym, level });
	}
	return roots;
}

/** The deepest chain of symbols whose range contains `pos` (`to` is exclusive, `from` inclusive). */
export function symbolChain(symbols: readonly Sym[], pos: number): Sym[] {
	const chain: Sym[] = [];
	let level: readonly Sym[] | undefined = symbols;
	while (level) {
		// Siblings may be unsorted in LSP output: take the narrowest container.
		let best: Sym | undefined;
		for (const s of level) {
			if (pos >= s.from && pos < s.to && (!best || s.to - s.from < best.to - best.from)) best = s;
		}
		if (!best) break;
		chain.push(best);
		level = best.children;
	}
	return chain;
}

/** Directory and file segments of a worktree-relative path (`a/b/c.ts` → a, b, c.ts). */
export function pathSegments(relPath: string): Segment[] {
	const parts = relPath.split("/").filter((p) => p !== "" && p !== ".");
	return parts.map((name, i) => ({
		kind: i === parts.length - 1 ? "file" : "dir",
		name,
		path: parts.slice(0, i + 1).join("/"),
	}));
}

/** Symbol segments for the caret at `pos`. */
export function breadcrumbPath(symbols: readonly Sym[], pos: number): Segment[] {
	return symbolChain(symbols, pos).map((s) => ({
		kind: "symbol",
		name: s.name,
		symbolKind: s.kind,
		from: s.from,
	}));
}

/** The parts of an LSP `DocumentSymbol` the breadcrumbs read. */
export interface LspDocSymbol {
	name: string;
	kind: number;
	range: { start: { line: number; character: number }; end: { line: number; character: number } };
	selectionRange: { start: { line: number; character: number }; end: { line: number; character: number } };
	children?: LspDocSymbol[];
}

/** LSP `SymbolKind` names, index = kind number. */
const LSP_KINDS = [
	"",
	"File",
	"Module",
	"Namespace",
	"Package",
	"Class",
	"Method",
	"Property",
	"Field",
	"Constructor",
	"Enum",
	"Interface",
	"Function",
	"Variable",
	"Constant",
	"String",
	"Number",
	"Boolean",
	"Array",
	"Object",
	"Key",
	"Null",
	"EnumMember",
	"Struct",
	"Event",
	"Operator",
	"TypeParameter",
];

/**
 * Tree of hierarchical `DocumentSymbol`s with offsets. `at` turns an LSP position into a document
 * offset. Locals (variables, constants, strings… inside a function) are dropped so the trail shows
 * scopes, not every `const x`.
 */
export function lspTree(
	symbols: readonly LspDocSymbol[],
	at: (p: { line: number; character: number }) => number,
): Sym[] {
	const LOCAL = new Set([13, 14, 15, 16, 17, 18, 19, 20, 21]);
	const visit = (s: LspDocSymbol, nested: boolean): Sym[] => {
		if (nested && LOCAL.has(s.kind)) return [];
		const kids = (s.children ?? []).flatMap((c) => visit(c, true));
		const sym: Sym = {
			name: s.name,
			kind: LSP_KINDS[s.kind] ?? "Symbol",
			from: at(s.range.start),
			to: at(s.range.end),
		};
		if (kids.length > 0) sym.children = kids;
		return [sym];
	};
	return symbols.flatMap((s) => visit(s, false));
}
