import { ws } from "#lib/stores/workspace.svelte.ts";

/** Single-quote for `sh -c`. */
export const shq = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/**
 * Open a terminal tab in the file's directory running `argv`. The shell stays open afterwards
 * (`exec $SHELL`) so the output remains readable once the command ends.
 */
export function runInTerminal(worktreeId: string, filePath: string, argv: string[], label: string) {
	const dir = filePath.split("/").slice(0, -1).join("/");
	const cmd = argv.map(shq).join(" ");
	const cd = dir ? `cd ${shq(dir)} && ` : "";
	return ws.newTerminal(worktreeId, {
		argv: ["sh", "-lc", `${cd}${cmd}; exec "\${SHELL:-sh}"`],
		label,
	});
}
