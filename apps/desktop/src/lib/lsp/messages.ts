/**
 * The sentence an LSP feature (F12, F2, ⇧F12, ⌘., format) shows when no server serves the file,
 * and the once-per-document gate so a held key never repeats it. Pure: the caller renders it.
 */
import type { ActionId, LspUiState } from "#lib/lsp/status.ts";

export type Feature =
	"definition" | "type-definition" | "implementation" | "references" | "rename" | "code-actions" | "format";

const NEEDS: Record<Feature, string> = {
	definition: "Go to definition needs a language server.",
	"type-definition": "Go to type definition needs a language server.",
	implementation: "Go to implementation needs a language server.",
	references: "Find references needs a language server.",
	rename: "Rename needs a language server.",
	"code-actions": "Code actions need a language server.",
	format: "Format with a language server needs one running for this file.",
};

/** What to say about why, per state; `undefined` = the state is serving (nothing to explain). */
function why(s: LspUiState): string | undefined {
	switch (s.kind) {
		case "ready":
			return undefined;
		case "starting":
			return "It is still starting; try again in a moment.";
		case "installing":
			return s.progress ? `It is installing (${s.progress}).` : "It is still installing.";
		case "host-old":
			return "Language features need a newer terminal host — restart it from the status bar.";
		case "host-updating":
			return "The terminal host is updating; language features return in a moment.";
		case "disabled-setting":
			return "Language servers are turned off in settings.";
		case "disabled-language":
			return "The server for this language is turned off in settings.";
		case "no-language":
			return "Atlas has no server for this file type — see the status bar for the supported languages.";
		case "crashed":
			return "The server stopped — restart it from the status bar.";
		case "outside-root":
			return "This file is outside the open worktrees.";
		default:
			return s.summary;
	}
}

/** One inline sentence for `feature` given the file's state; `undefined` when a server serves it. */
export function reasonForFeature(feature: Feature, s: LspUiState): string | undefined {
	const reason = why(s);
	return reason === undefined ? undefined : `${NEEDS[feature]} ${reason}`;
}

/** The action to offer next to the sentence (the most useful one for the state), if any. */
export function hintAction(s: LspUiState): { id: ActionId; label: string } | undefined {
	const a = s.actions.find((x) => x.primary) ?? s.actions[0];
	return a ? { id: a.id, label: a.label } : undefined;
}

/**
 * Each (document, feature) shows its explanation once; afterwards the shortcut is silent so a
 * repeated F12 does not nag. `session` is the document (any object) the editor holds.
 */
const shown = new WeakMap<object, Set<Feature>>();

/** True the first time `feature` is explained for `session`; false afterwards. */
export function firstTime(session: object, feature: Feature): boolean {
	let set = shown.get(session);
	if (!set) shown.set(session, (set = new Set()));
	if (set.has(feature)) return false;
	set.add(feature);
	return true;
}

/** A held key repeats every ~30 ms; anything slower is a deliberate press. */
const HOLD_MS = 400;
const lastShown = new WeakMap<object, Map<Feature, number>>();

/**
 * What to do with a shortcut that has nothing to run: `show` the reason, or `hold` (a key held down
 * repeats; one note is enough). Unlike `firstTime`, a later deliberate press is answered again: a
 * shortcut that does nothing and says nothing is the bug this exists to prevent.
 */
export function feedbackFor(session: object, feature: Feature, now = Date.now()): "show" | "hold" {
	let m = lastShown.get(session);
	if (!m) lastShown.set(session, (m = new Map()));
	const prev = m.get(feature);
	m.set(feature, now);
	return prev !== undefined && now - prev < HOLD_MS ? "hold" : "show";
}

/** Forget what was shown for `session` (the state changed: a new explanation is news again). */
export function resetHints(session: object) {
	shown.delete(session);
}
