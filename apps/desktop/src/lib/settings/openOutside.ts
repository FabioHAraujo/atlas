import { toast } from "@codeatlasdev/ui";
import { errText } from "#lib/api.ts";
import { openFile } from "#lib/stores/files.svelte.ts";
import { updates } from "#lib/stores/updates.svelte.ts";
import { ws } from "#lib/stores/workspace.svelte.ts";
import { relativeFrom } from "./path.ts";

/**
 * Open an absolute `file` in an editor tab of the selected worktree and close Settings so
 * it is visible. Without a worktree there is no editor to show it in, so say so.
 */
export function openOutsideWorktree(file: string, what: string): boolean {
	const w = ws.selected;
	if (!w) {
		toast.info(`Open a worktree first, then Atlas can show ${what} in its editor.`);
		return false;
	}
	try {
		openFile(w.id, relativeFrom(w.path, file.replace(/\/{2,}/g, "/")));
		updates.open = false;
		return true;
	} catch (e) {
		toast.error(errText(e));
		return false;
	}
}
