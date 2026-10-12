/**
 * "Ask AI" hands the prompt to a coding agent in the current worktree. Resolved lazily and
 * defensively: this runs while something is already broken, so a missing store, no open worktree
 * or a failed launch just leaves the prompt on the clipboard (the caller always copies first).
 */
export async function launchAgent(prompt: string): Promise<boolean> {
	try {
		const [{ ws }, { agents }] = await Promise.all([
			import("#lib/stores/workspace.svelte.ts"),
			import("#lib/stores/agents.svelte.ts"),
		]);
		const w = ws.selected;
		if (!w) return false;
		return !!(await agents.launch(w.id, undefined, { prompt }));
	} catch {
		return false;
	}
}
