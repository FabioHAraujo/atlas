/** Document symbols from the language server, flattened for the "Go to symbol" palette. */
import type { EditorView } from "@codemirror/view";
import { envOf, posParams } from "#lib/lsp/context.ts";
import { posToOffset, type Position, type Range } from "#lib/lsp/convert.ts";

export interface LspSymbol {
	name: string;
	kind: string;
	from: number;
	line: number;
	container?: string;
}

/** LSP `SymbolKind` names. */
const KINDS = [
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

interface DocumentSymbol {
	name: string;
	kind: number;
	range: Range;
	selectionRange: Range;
	children?: DocumentSymbol[];
}
interface SymbolInformation {
	name: string;
	kind: number;
	containerName?: string;
	location: { range: Range };
}

/** Locals and noise (variables inside functions) are skipped like Zed's outline does. */
const SKIP = new Set([13, 14, 15, 16, 17, 18, 19, 20, 21]);

export function flattenSymbols(
	view: EditorView,
	res: (DocumentSymbol | SymbolInformation)[],
	at: (p: Position) => number = (p) => posToOffset(view.state.doc, p),
): LspSymbol[] {
	const out: LspSymbol[] = [];
	const doc = view.state.doc;
	const visit = (s: DocumentSymbol, container?: string) => {
		if (!SKIP.has(s.kind) || !container) {
			const from = at(s.selectionRange.start);
			out.push({
				name: s.name,
				kind: KINDS[s.kind] ?? "Symbol",
				from,
				line: doc.lineAt(from).number,
				container,
			});
		}
		for (const c of s.children ?? []) visit(c, s.name);
	};
	for (const s of res) {
		if ("location" in s) {
			const from = at(s.location.range.start);
			out.push({
				name: s.name,
				kind: KINDS[s.kind] ?? "Symbol",
				from,
				line: doc.lineAt(from).number,
				container: s.containerName || undefined,
			});
		} else visit(s);
	}
	return out;
}

/** Latest result per view; the palette reads it reactively, `loadSymbols` fills it when it opens. */
export const lspSymbols = $state<{ view: EditorView | null; list: LspSymbol[] | null }>({
	view: null,
	list: null,
});

export async function loadSymbols(view: EditorView) {
	lspSymbols.view = view;
	lspSymbols.list = null;
	const env = envOf(view);
	if (!env?.doc.open || !env.doc.caps?.documentSymbolProvider) return;
	const res = await env.doc
		.request<(DocumentSymbol | SymbolInformation)[]>("textDocument/documentSymbol", {
			textDocument: posParams(view, env, 0).textDocument,
		})
		.catch(() => null);
	if (lspSymbols.view === view && res?.length) lspSymbols.list = flattenSymbols(view, res);
}
