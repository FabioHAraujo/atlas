/** Gathers the live facts for one document and feeds the pure reducer in `status.ts`. */
import { lsp, serverFor, type LspDoc } from "#lib/lsp/client.svelte.ts";
import { hostGate } from "#lib/lsp/hostGate.ts";
import { locate } from "#lib/lsp/workspace.ts";
import { lspUiState, type LspUiState } from "#lib/lsp/status.ts";
import { prefs } from "#lib/stores/prefs.svelte.ts";

/** Language servers are off for `languageId` right now: setting, per-language override, or an old host. */
export const lspGated = (languageId: string): boolean =>
	!prefs.value.enable_language_servers ||
	prefs.value.lsp?.[languageId]?.disabled === true ||
	!hostGate.lspReady;

/** Reads reactive stores: call inside `$derived`/`$effect`/markup to stay live. */
export function uiStateOf(doc: LspDoc): LspUiState {
	void lsp.servers;
	return lspUiState({
		prefsEnabled: prefs.value.enable_language_servers,
		languageId: doc.languageId,
		host: doc.hostOld ? { ...hostGate.facts, lsp: false } : hostGate.facts,
		doc: doc.replied
			? { status: doc.status, server: doc.server, reason: doc.reason, supported: doc.supported }
			: undefined,
		srv: serverFor(doc.path),
		outsideRoot: !locate(doc.path),
		languageDisabled: prefs.value.lsp?.[doc.languageId]?.disabled === true,
	});
}
