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
