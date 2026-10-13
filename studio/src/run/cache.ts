// Capture cache: studio/.cache/captures/<recipe>/<key>/{video.mov, timeline.json, shots/*.png, done.json}.
// `done.json` is written LAST, so a crashed or interrupted run leaves no marker and is never mistaken for a result.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { StudioError } from "../lib/paths.ts";
import type { BuildId } from "./recipe.ts";

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

export interface EntryMeta {
	capture: string;
	build: BuildId;
	recordedAt: string;
}
export interface Entry {
	dir: string;
	video: string;
	timeline: string;
	shots: string[];
	meta: EntryMeta;
}

function segment(s: string, what: string): string {
	if (!SEGMENT.test(s)) throw new StudioError(`${what} ${JSON.stringify(s)} is not a safe path segment`);
	return s;
}

export const entryDir = (root: string, recipe: string, key: string) => join(root, segment(recipe, "recipe id"), segment(key, "cache key"));

/** Mark a finished capture directory as a result. Call after every file is in place. */
export function writeEntry(root: string, recipe: string, key: string, meta: EntryMeta): void {
	const dir = entryDir(root, recipe, key);
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, "done.json"), `${JSON.stringify(meta, null, "\t")}\n`);
}

export function readEntry(root: string, recipe: string, key: string): Entry | undefined {
	const dir = entryDir(root, recipe, key);
	const marker = join(dir, "done.json");
	const video = join(dir, "video.mov");
	const timeline = join(dir, "timeline.json");
	if (!existsSync(marker) || !existsSync(video) || !existsSync(timeline)) return undefined;
	let meta: EntryMeta;
	try {
		meta = JSON.parse(readFileSync(marker, "utf8")) as EntryMeta;
	} catch {
		return undefined;
	}
	const shotsDir = join(dir, "shots");
	const shots = existsSync(shotsDir)
		? readdirSync(shotsDir)
				.filter((f) => f.endsWith(".png"))
				.sort()
				.map((f) => join(shotsDir, f))
		: [];
	return { dir, video, timeline, shots, meta };
}

/** Keys of every valid entry of `recipe`. */
export function cachedKeys(root: string, recipe: string): Set<string> {
	const base = join(root, segment(recipe, "recipe id"));
	if (!existsSync(base)) return new Set();
	return new Set(readdirSync(base).filter((k) => SEGMENT.test(k) && readEntry(root, recipe, k) !== undefined));
}
