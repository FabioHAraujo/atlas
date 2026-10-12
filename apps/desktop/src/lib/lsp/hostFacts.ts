/** Pure mapping from the terminal host's state to the facts the LSP status reducer reads. */
import type { HostFacts } from "#lib/lsp/status.ts";

/** The fields of the host store this mapping reads (the store has more). */
export interface HostLike {
	status: string;
	proto: number | null;
	caps: readonly string[];
	skew: string;
	ptys: readonly { title: string; cwd: string }[];
}

/**
 * `lsp` is true until the host has been reconciled (`proto === null`: its caps are not known yet,
 * so a file opened at startup must not be told its host is too old). `updating` covers a live
 * upgrade in flight or pending, which loses no terminal.
 */
export function hostFacts(h: HostLike): Required<HostFacts> {
	return {
		lsp: h.proto === null || h.caps.includes("lsp"),
		updating: h.status === "upgrading" || h.skew === "upgradable",
		ptys: h.ptys.map((p) => ({ title: p.title, cwd: p.cwd })),
	};
}

/**
 * An old `atlas hostd` rejects `lsp_*` with serde's `unknown variant` (it predates the commands).
 * That is the one reliable sign the host is too old even before its caps were reconciled.
 */
export function isHostTooOld(err: unknown): boolean {
	const text = err instanceof Error ? err.message : typeof err === "string" ? err : "";
	return /unknown variant `lsp_\w+`/.test(text);
}

/** The `lsp_open` request body (field names are the Rust side's, see `HostCmd::LspOpen`). */
export function openPayload(o: {
	path: string;
	languageId: string;
	text: string;
	version: number;
	root?: string;
	overrides?: unknown;
}) {
	return {
		path: o.path,
		language_id: o.languageId,
		text: o.text,
		version: o.version,
		...(o.root ? { root: o.root } : {}),
		...(o.overrides ? { overrides: o.overrides } : {}),
	};
}
