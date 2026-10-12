import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet } from "@codemirror/view";
import { toast } from "@codeatlasdev/ui";
import type { PaletteItem } from "#lib/components/Palette.svelte";
import { lspCompletion } from "#lib/lsp/completion.ts";
import { envOf, lspEnv, type LspEnv } from "#lib/lsp/context.ts";
import { lspGutter } from "#lib/lsp/diagnostics.ts";
import { lspFeatureTheme, lspHighlight, lspHover, lspInlayHints, lspSignature } from "#lib/lsp/features.ts";
import { codeActionsAt, formatDocument, goToDefinition, runCodeAction } from "#lib/lsp/actions.ts";
import { explainUnserved } from "#lib/lsp/hints.svelte.ts";
import { showPicker } from "#lib/lsp/picker.svelte.ts";
import { hoverLink, isGoToClick, isGoToModifier, isMac } from "#lib/lsp/navigation.ts";

export async function codeActionMenu(view: EditorView) {
	const env = envOf(view);
	if (!env || !explainUnserved(view, "code-actions")) return;
	const sel = view.state.selection.main;
	const actions = await codeActionsAt(view, sel.from, sel.to);
	if (actions.length === 0) return toast.info("No code actions here");
	const items: PaletteItem[] = actions.map((a, i) => ({
		id: `${i}`,
		group: a.kind?.startsWith("quickfix") ? "Quick fixes" : "Code actions",
		label: a.title,
		description: a.kind,
		run: () => void runCodeAction(view, a).then(() => view.focus()),
	}));
	showPicker("Code actions", items);
}

/**
 * ⌘-hover underlines the identifier under the pointer (Ctrl on other platforms) and ⌘-click jumps to
 * its definition. The modifier is read on every pointer move *and* on key down/up, so pressing ⌘ while
 * the pointer rests on a symbol underlines it at once, like VS Code and Zed.
 */
const setLink = StateEffect.define<{ from: number; to: number } | null>();

const linkField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(deco, tr) {
		for (const e of tr.effects)
			if (e.is(setLink))
				return e.value ? Decoration.set([linkMark.range(e.value.from, e.value.to)]) : Decoration.none;
		return tr.docChanged ? Decoration.none : deco;
	},
	provide: (f) => EditorView.decorations.from(f),
});
const linkMark = Decoration.mark({ class: "cm-lsp-link" });

const linkPlugin = ViewPlugin.fromClass(
	class {
		pointer: { x: number; y: number } | null = null;
		constructor(readonly view: EditorView) {}
		refresh(mod: boolean) {
			const v = this.view;
			const at = mod && this.pointer ? v.posAtCoords(this.pointer) : null;
			const link = envOf(v) ? hoverLink(v.state, at) : null;
			const cur = v.state.field(linkField).size > 0;
			if (link || cur) v.dispatch({ effects: setLink.of(link) });
		}
	},
	{
		eventHandlers: {
			mousemove(e) {
				this.pointer = { x: e.clientX, y: e.clientY };
				this.refresh(isGoToModifier(e, isMac()));
			},
			mouseleave() {
				this.pointer = null;
				this.refresh(false);
			},
			keydown(e) {
				if (e.key === "Meta" || e.key === "Control")
					this.refresh(isGoToModifier({ ...e, [e.key === "Meta" ? "metaKey" : "ctrlKey"]: true }, isMac()));
			},
			keyup(e) {
				if (e.key === "Meta" || e.key === "Control") this.refresh(false);
			},
			blur() {
				this.refresh(false);
			},
		},
	},
);

/** The click: a go-to modifier + primary button moves the caret there first, then jumps. */
const cmdClick = EditorView.domEventHandlers({
	mousedown(e, view) {
		if (!isGoToClick(e, isMac()) || !envOf(view)) return false;
		const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
		if (pos === null) return false;
		e.preventDefault();
		view.dispatch({ selection: { anchor: pos }, effects: setLink.of(null) });
		void goToDefinition(view);
		return true;
	},
});

export interface LspExtensionOptions {
	env: LspEnv;
}

export { lspCompletion };

/** Every LSP editor feature for one view, driven by `env` (document sync + host effects). */
export function lspExtension({ env }: LspExtensionOptions): Extension {
	return [
		lspEnv.of(env),
		lspHover,
		lspSignature,
		lspHighlight,
		lspInlayHints,
		lspGutter,
		linkField,
		linkPlugin,
		cmdClick,
		lspFeatureTheme,
	];
}

/** Format on save: ask the server first; the caller saves the (possibly reformatted) text after. */
export async function formatBeforeSave(view: EditorView): Promise<void> {
	const env = envOf(view);
	if (!env?.formatOnSave() || !env.doc.open) return;
	await formatDocument(view).catch(() => false);
}
