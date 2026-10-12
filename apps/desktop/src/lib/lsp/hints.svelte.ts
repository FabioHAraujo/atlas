/**
 * The "why nothing happened" hint for LSP shortcuts. It shows once per document and feature, as
 * a short inline note by the status item (`LspHint.svelte`) with the state's main action, and
 * dismisses itself. After that the shortcut is silent.
 */
import type { EditorView } from "@codemirror/view";
import { envOf } from "#lib/lsp/context.ts";
import { runAction } from "#lib/lsp/run.ts";
import { feedbackFor, hintAction, reasonForFeature, type Feature } from "#lib/lsp/messages.ts";
import { uiStateOf } from "#lib/lsp/uiState.svelte.ts";
import type { ActionId } from "#lib/lsp/status.ts";

const SHOW_MS = 8000;

export interface Hint {
	message: string;
	action?: { id: ActionId; label: string };
	/** Document the hint belongs to, so the status item only shows its own. */
	path: string;
}

export const hint = $state<{ current: Hint | null }>({ current: null });
let timer: number | undefined;

export function dismissHint() {
	clearTimeout(timer);
	hint.current = null;
}

/** Run the action of the visible hint and hide it. */
export function runHintAction() {
	const a = hint.current?.action;
	const path = hint.current?.path;
	dismissHint();
	if (a && path) void runAction(a.id, path);
}

/**
 * Explain why `feature` did nothing. Returns true when the caller can go on (a server serves the
 * file, or the file has no language session at all so there is nothing to explain); false when the
 * reason was shown (or is already on screen because the key is held) and the caller should stop.
 * Every deliberate press is answered: a shortcut that does nothing and says nothing is a bug.
 */
export function explainUnserved(view: EditorView, feature: Feature): boolean {
	const env = envOf(view);
	if (!env || env.doc.open) return true;
	const state = uiStateOf(env.doc);
	const message = reasonForFeature(feature, state);
	if (message === undefined) return true;
	if (feedbackFor(env.doc, feature) === "hold") return false;
	clearTimeout(timer);
	hint.current = { message, action: hintAction(state), path: env.doc.path };
	timer = window.setTimeout(dismissHint, SHOW_MS);
	return false;
}
