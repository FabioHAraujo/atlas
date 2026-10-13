// Cache-busting versions for /media files. Media is cached for 30 days, so a recut needs a new URL.
// The version comes from the tracked public/media/manifest.json (sha256 per file, written by
// `bun studio publish`), never from the file bytes: heavy videos are not in git, and a build that
// does not have them (fresh checkout, CI) must still emit the same versioned URLs.
import { readFileSync } from "node:fs";
import { join } from "node:path";

type Manifest = { files: Record<string, { sha256: string }> };
const cache = new Map<string, Manifest>();

/** First 10 hex chars of the file's sha256 from the manifest; `null` if the manifest does not list it. */
export function mediaVersion(file: string, root = process.cwd()): string | null {
	const path = join(root, "public/media/manifest.json");
	let m = cache.get(path);
	if (!m) {
		m = JSON.parse(readFileSync(path, "utf8")) as Manifest;
		cache.set(path, m);
	}
	return m.files[file]?.sha256.slice(0, 10) ?? null;
}
