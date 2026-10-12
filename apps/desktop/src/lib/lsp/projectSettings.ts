/**
 * `.atlas/settings.json` in a worktree root: `{ "lsp": { "<languageId>": { … } } }`. Read through
 * hostd with a short cache; saving the file invalidates it. A missing file is normal; invalid JSON
 * never throws, it is reported as a one-line warning for the status popover.
 */
import { b64decode, host } from "#lib/host.ts";
import { parseProjectSettings, type ProjectLsp } from "#lib/lsp/projectParse.ts";

const TTL_MS = 5000;
const MAX_BYTES = 256 * 1024;

interface Entry {
	at: number;
	value: Promise<ProjectLsp>;
}

const cache: Record<string, Entry> = {};

async function load(root: string): Promise<ProjectLsp> {
	try {
		const r = await host.fsRead(`${root}/.atlas/settings.json`, MAX_BYTES);
		return parseProjectSettings(b64decode(r.data));
	} catch {
		// Absent (the usual case) or unreadable: no overrides, nothing to warn about.
		return { lsp: {} };
	}
}

/** Project overrides for the worktree at `root`, cached for a few seconds. */
export function projectLsp(root: string): Promise<ProjectLsp> {
	const hit = cache[root];
	if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
	const value = load(root);
	cache[root] = { at: Date.now(), value };
	return value;
}

/** Drop the cached file of `root` (call when `.atlas/settings.json` is saved). */
export function invalidateProjectSettings(root: string) {
	delete cache[root];
}

/** True when `abs` is the project settings file of `root`. */
export const isProjectSettingsPath = (root: string, abs: string) => abs === `${root}/.atlas/settings.json`;
