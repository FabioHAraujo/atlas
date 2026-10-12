import { StateEffect, StateField, type Extension, RangeSetBuilder } from "@codemirror/state";
import {
	Decoration,
	EditorView,
	ViewPlugin,
	WidgetType,
	hoverTooltip,
	showTooltip,
	type DecorationSet,
	type Tooltip,
	type ViewUpdate,
} from "@codemirror/view";
import { mdNode } from "#lib/lsp/completion.ts";
import { envOf, posParams } from "#lib/lsp/context.ts";
import { posToOffset, rangeToOffsets, type Range } from "#lib/lsp/convert.ts";

type MarkedString = string | { language: string; value: string };
interface Hover {
	contents: MarkedString | MarkedString[] | { kind: string; value: string };
	range?: Range;
}

/** Hover contents as one markdown string (LSP allows MarkedString, MarkedString[] and MarkupContent). */
export function hoverMarkdown(c: Hover["contents"]): string {
	const one = (m: MarkedString | { kind: string; value: string }): string =>
		typeof m === "string" ? m : "language" in m ? `\`\`\`${m.language}\n${m.value}\n\`\`\`` : m.value;
	return (Array.isArray(c) ? c.map(one) : [one(c)]).filter(Boolean).join("\n\n---\n\n");
}

export const lspHover = hoverTooltip(
	async (view, pos) => {
		const env = envOf(view);
		if (!env?.doc.open || !env.doc.caps?.hoverProvider) return null;
		const h = await env.doc.request<Hover>("textDocument/hover", posParams(view, env, pos));
		if (!h?.contents) return null;
		const md = hoverMarkdown(h.contents);
		if (!md.trim()) return null;
		const [from, to] = h.range ? rangeToOffsets(view.state.doc, h.range) : [pos, pos];
		return { pos: from, end: to, above: true, create: () => ({ dom: mdNode(md, "cm-lsp-hover") }) };
	},
	{ hideOnChange: true, hoverTime: 350 },
);

// --- Signature help -------------------------------------------------------------------------

interface SignatureHelp {
	signatures: {
		label: string;
		documentation?: string | { value: string };
		parameters?: { label: string | [number, number]; documentation?: string | { value: string } }[];
		activeParameter?: number;
	}[];
	activeSignature?: number;
	activeParameter?: number;
}

const setSignature = StateEffect.define<{ pos: number; help: SignatureHelp } | null>();

function signatureDom(help: SignatureHelp): HTMLElement {
	const sig = help.signatures[help.activeSignature ?? 0] ?? help.signatures[0];
	const dom = document.createElement("div");
	dom.className = "cm-lsp-sig";
	const label = document.createElement("div");
	label.className = "cm-lsp-sig-label";
	const active = sig.activeParameter ?? help.activeParameter ?? 0;
	const p = sig.parameters?.[active]?.label;
	const range: [number, number] | null =
		typeof p === "string"
			? sig.label.indexOf(p) >= 0
				? [sig.label.indexOf(p), sig.label.indexOf(p) + p.length]
				: null
			: (p ?? null);
	if (range) {
		label.append(sig.label.slice(0, range[0]));
		const b = document.createElement("b");
		b.textContent = sig.label.slice(range[0], range[1]);
		label.append(b, sig.label.slice(range[1]));
	} else label.textContent = sig.label;
	dom.append(label);
	const docs = typeof sig.documentation === "string" ? sig.documentation : sig.documentation?.value;
	if (docs) dom.append(mdNode(docs, "cm-lsp-sig-doc"));
	return dom;
}

const signatureField = StateField.define<{ pos: number; help: SignatureHelp } | null>({
	create: () => null,
	update(v, tr) {
		for (const e of tr.effects) if (e.is(setSignature)) return e.value;
		if (!v) return v;
		const pos = tr.changes.mapPos(v.pos);
		// Moving the caret in front of the call closes it.
		return tr.state.selection.main.head < pos ? null : { ...v, pos };
	},
	provide: (f) =>
		showTooltip.compute([f], (state): Tooltip | null => {
			const v = state.field(f);
			return v
				? { pos: v.pos, above: true, strictSide: true, create: () => ({ dom: signatureDom(v.help) }) }
				: null;
		}),
});

async function requestSignature(view: EditorView, triggerChar?: string) {
	const env = envOf(view);
	if (!env?.doc.open || !env.doc.caps?.signatureHelpProvider) return;
	const head = view.state.selection.main.head;
	const help = await env.doc.request<SignatureHelp | null>("textDocument/signatureHelp", {
		...posParams(view, env, head),
		context: triggerChar
			? { triggerKind: 2, triggerCharacter: triggerChar, isRetrigger: false }
			: { triggerKind: 1, isRetrigger: false },
	});
	view.dispatch({
		effects: setSignature.of(help?.signatures?.length ? { pos: head, help } : null),
	});
}

/** Typing a trigger char (`(`, `,`) opens signature help; typing a retrigger char refreshes it; `)` closes it. */
const signatureTriggers = EditorView.inputHandler.of((view, _from, _to, text) => {
	const env = envOf(view);
	const sp = env?.doc.caps?.signatureHelpProvider;
	if (!sp || text.length !== 1) return false;
	const open = view.state.field(signatureField, false);
	if (text === ")" && open) {
		queueMicrotask(() => view.dispatch({ effects: setSignature.of(null) }));
		return false;
	}
	if (sp.triggerCharacters?.includes(text) || (open && sp.retriggerCharacters?.includes(text)))
		queueMicrotask(() => void requestSignature(view, text));
	return false;
});

export const lspSignature: Extension = [
	signatureField,
	signatureTriggers,
	EditorView.domEventHandlers({
		keydown(e, view) {
			if (e.key === "Escape" && view.state.field(signatureField, false)) {
				view.dispatch({ effects: setSignature.of(null) });
			}
			return false;
		},
	}),
];

// --- Document highlight (symbol under the caret) ---------------------------------------------

const highlightMark = Decoration.mark({ class: "cm-lsp-highlight" });
const setHighlights = StateEffect.define<DecorationSet>();
const highlightField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(v, tr) {
		for (const e of tr.effects) if (e.is(setHighlights)) return e.value;
		return tr.docChanged || tr.selection ? Decoration.none : v;
	},
	provide: (f) => EditorView.decorations.from(f),
});

const HIGHLIGHT_IDLE_MS = 150;
const highlightPlugin = ViewPlugin.fromClass(
	class {
		timer: number | undefined;
		seq = 0;
		update(u: ViewUpdate) {
			if (!u.selectionSet && !u.docChanged) return;
			clearTimeout(this.timer);
			const view = u.view;
			this.timer = window.setTimeout(() => void this.run(view), HIGHLIGHT_IDLE_MS);
		}
		async run(view: EditorView) {
			const env = envOf(view);
			if (!env?.doc.open || !env.doc.caps?.documentHighlightProvider) return;
			const seq = ++this.seq;
			const head = view.state.selection.main.head;
			const res = await env.doc
				.request<{ range: Range }[]>("textDocument/documentHighlight", posParams(view, env, head))
				.catch(() => null);
			if (seq !== this.seq || !res?.length) return;
			const b = new RangeSetBuilder<Decoration>();
			const spans = res
				.map((h) => rangeToOffsets(view.state.doc, h.range))
				.filter(([f, t]) => t > f)
				.sort((a, c) => a[0] - c[0]);
			for (const [f, t] of spans) b.add(f, t, highlightMark);
			view.dispatch({ effects: setHighlights.of(b.finish()) });
		}
		destroy() {
			clearTimeout(this.timer);
		}
	},
);

export const lspHighlight: Extension = [highlightField, highlightPlugin];

// --- Inlay hints ------------------------------------------------------------------------------

interface InlayHint {
	position: { line: number; character: number };
	label: string | { value: string }[];
	kind?: 1 | 2;
	paddingLeft?: boolean;
	paddingRight?: boolean;
}

class HintWidget extends WidgetType {
	constructor(
		readonly text: string,
		readonly kind: number | undefined,
		readonly padL: boolean,
		readonly padR: boolean,
	) {
		super();
	}
	eq(o: HintWidget) {
		return o.text === this.text && o.kind === this.kind;
	}
	toDOM() {
		const s = document.createElement("span");
		s.className = `cm-lsp-hint cm-lsp-hint-${this.kind === 1 ? "type" : "param"}`;
		s.textContent = this.text;
		if (this.padL) s.style.marginLeft = "0.3em";
		if (this.padR) s.style.marginRight = "0.3em";
		return s;
	}
}

const setHints = StateEffect.define<DecorationSet>();
const hintField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(v, tr) {
		for (const e of tr.effects) if (e.is(setHints)) return e.value;
		return tr.docChanged ? v.map(tr.changes) : v;
	},
	provide: (f) => EditorView.decorations.from(f),
});

const HINT_IDLE_MS = 300;
const hintPlugin = ViewPlugin.fromClass(
	class {
		timer: number | undefined;
		seq = 0;
		constructor(view: EditorView) {
			this.schedule(view, 600);
		}
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged) this.schedule(u.view, HINT_IDLE_MS);
		}
		schedule(view: EditorView, ms: number) {
			clearTimeout(this.timer);
			this.timer = window.setTimeout(() => void this.run(view), ms);
		}
		async run(view: EditorView) {
			const env = envOf(view);
			if (!env?.doc.open || !env.inlayHints() || !env.doc.caps?.inlayHintProvider) return;
			const seq = ++this.seq;
			const { from, to } = view.viewport;
			const doc = view.state.doc;
			const range: Range = {
				start: { line: doc.lineAt(from).number - 1, character: 0 },
				end: { line: doc.lineAt(to).number - 1, character: doc.lineAt(to).length },
			};
			const hints = await env.doc
				.request<InlayHint[]>("textDocument/inlayHint", {
					textDocument: posParams(view, env, 0).textDocument,
					range,
				})
				.catch(() => null);
			if (seq !== this.seq || !hints || view.state.doc !== doc) return;
			const b = new RangeSetBuilder<Decoration>();
			const sorted = hints.map((h) => ({ h, at: posToOffset(doc, h.position) })).sort((a, c) => a.at - c.at);
			for (const { h, at } of sorted) {
				const text = typeof h.label === "string" ? h.label : h.label.map((p) => p.value).join("");
				b.add(
					at,
					at,
					Decoration.widget({
						widget: new HintWidget(text, h.kind, h.paddingLeft ?? false, h.paddingRight ?? false),
						side: 1,
					}),
				);
			}
			view.dispatch({ effects: setHints.of(b.finish()) });
		}
		destroy() {
			clearTimeout(this.timer);
		}
	},
);

export const lspInlayHints: Extension = [hintField, hintPlugin];

export const lspFeatureTheme = EditorView.baseTheme({
	".cm-lsp-highlight": {
		backgroundColor: "var(--cm-lsp-highlight, var(--cm-selection, var(--ca-action-selected)))",
		borderRadius: "2px",
	},
	".cm-lsp-hint": {
		color: "var(--cm-syn-hint, var(--ca-text-disabled))",
		fontSize: "0.88em",
		fontStyle: "var(--cm-syn-hint-italic, italic)",
		fontWeight: "var(--cm-syn-hint-weight, normal)",
		opacity: 0.9,
		pointerEvents: "none",
	},
	".cm-lsp-hover, .cm-lsp-sig": {
		maxWidth: "560px",
		maxHeight: "320px",
		overflow: "auto",
		padding: "6px 10px",
		fontSize: "12px",
		lineHeight: 1.45,
		userSelect: "text",
	},
	".cm-lsp-hover pre.code, .cm-lsp-doc pre.code": {
		margin: "4px 0",
		padding: "4px 6px",
		borderRadius: "5px",
		background: "var(--ca-surface-sunken)",
		overflow: "auto",
		fontFamily: "var(--mono)",
		whiteSpace: "pre",
	},
	".cm-lsp-hover p, .cm-lsp-doc p": { margin: "4px 0" },
	".cm-lsp-hover code, .cm-lsp-doc code": { fontFamily: "var(--mono)" },
	".cm-lsp-doc": { maxWidth: "420px", padding: "4px 6px", fontSize: "12px" },
	".cm-lsp-sig-label": { fontFamily: "var(--mono)", whiteSpace: "pre-wrap" },
	".cm-lsp-sig-label b": {
		color: "var(--cm-syn-variable-parameter, var(--ca-brand-main))",
		textDecoration: "underline",
	},
});
