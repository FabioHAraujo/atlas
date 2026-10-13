// A debug bundle embeds the frontend at build time. Recording from one that predates the sources records an OLD UI
// without any sign of it, so the capture refuses a stale bundle and says how to rebuild.

import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SKIP = new Set(["node_modules", "target", ".svelte-kit", "build", ".git"]);

/** Newest mtime (ms) of any file under `dirs`, recursively; 0 when there is none. */
export function newestMtimeMs(dirs: string[]): number {
	let newest = 0;
	const walk = (dir: string) => {
		if (!existsSync(dir)) return;
		for (const e of readdirSync(dir, { withFileTypes: true })) {
			if (SKIP.has(e.name)) continue;
			const p = join(dir, e.name);
			if (e.isDirectory()) walk(p);
			else newest = Math.max(newest, statSync(p).mtimeMs);
		}
	};
	for (const d of dirs) walk(d);
	return newest;
}

/** Why `bundle` is older than the sources (message), or undefined when it is fresh or absent (absence is reported elsewhere). */
export function staleReason(bundle: string, sourceDirs: string[]): string | undefined {
	if (!existsSync(bundle)) return undefined;
	const built = statSync(bundle).mtimeMs;
	const newest = newestMtimeMs(sourceDirs);
	if (newest <= built) return undefined;
	const hours = Math.round(((newest - built) / 3_600_000) * 10) / 10;
	return `the debug bundle is older than the app sources (by ${hours} h): it would record an old UI`;
}
