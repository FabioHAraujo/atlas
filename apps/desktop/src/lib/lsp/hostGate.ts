/**
 * The one adapter between the LSP UI and the terminal host's version state. The host lifecycle
 * lives in `stores/hostStatus.svelte.ts` (owned by the updates work); nothing else under `lsp/`
 * imports it.
 */
import { hostFacts } from "#lib/lsp/hostFacts.ts";
import { hostState, restartHost, postponeHost, restartHostWhenIdle } from "#lib/stores/hostStatus.svelte.ts";

/** Reactive view of the host for the LSP UI. */
export const hostGate = {
	/** The connected hostd serves `lsp_*` (also true before the first reconcile: see `hostFacts`). */
	get lspReady(): boolean {
		return hostFacts(hostState).lsp;
	},
	/** `lsp`, a live upgrade in progress (no terminal lost), and the terminals a restart would end. */
	get facts() {
		return hostFacts(hostState);
	},
};

/** True when the connected host can run language servers. */
export const lspAvailable = (): boolean => hostGate.lspReady;

export { restartHost, postponeHost, restartHostWhenIdle };
