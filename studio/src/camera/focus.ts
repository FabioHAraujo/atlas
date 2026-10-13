// Where each thing the viewer must read IS in the source. A scene's Focus names it three ways, best first:
//   selector  the recording's timeline.json holds the rect the app measured at the recipe's `focus` step ("timeline");
//   rect      the film data gives source pixels directly ("rect");
//   text      footage recorded without focus steps: OCR a frame and find the line ("ocr", cached by content).
// Everything returned is in SOURCE PIXELS of the scene's crop (see types.ts), clipped to it.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { FocusHint, Timeline } from "../../../apps/desktop/src/lib/capture/timeline.ts";
import { parseTimeline } from "../../../apps/desktop/src/lib/capture/timeline.ts";
import { assetPath } from "../lib/assets.ts";
import { ffmpeg, sha256, sha256File } from "../lib/exec.ts";
import { CACHE, StudioError } from "../lib/paths.ts";
import type { AppClipScene, Crop, Rect } from "../lib/types.ts";
import { ocr, type TextBox } from "../lint/ocr.ts";
import type { ResolvedFocus } from "./types.ts";

/** The part of an app scene the resolver needs: which recording, where in it, and the crop the film shows. */
export type FocusScene = Pick<AppClipScene, "clip" | "from" | "crop" | "focus">;

export interface ResolveOpts {
	/** timeline.json of the recording; default: the one beside the clip's video (`timelineOfClip`) */
	timeline?: string;
	/** the recording's video, for the OCR fallback; default: the clip's asset */
	video?: string;
}

function readTimeline(path: string): Timeline {
	const parsed = parseTimeline(JSON.parse(readFileSync(path, "utf8")));
	if (!parsed.ok) throw new StudioError(`${path} is not a capture timeline`, parsed.errors.join("\n"));
	return parsed.timeline;
}

/** The focus hints a recording's timeline holds; `[]` for timelines recorded before the `focus` step existed. */
export function readFocusHints(timelinePath: string): FocusHint[] {
	return readTimeline(timelinePath).focus;
}

/** `timeline.json` beside the clip's video (recordings of `bun studio run`); undefined for older, timeline-less ones. */
export function timelineOfClip(clipKey: string): string | undefined {
	const t = join(dirname(assetPath(clipKey)), "timeline.json");
	return existsSync(t) ? t : undefined;
}

/**
 * CSS px of the app window -> source px of the crop: the recording is `scale` px per CSS px, and the crop's origin
 * is the new (0,0). Clipped to the crop; undefined when nothing of the rect is inside it.
 */
export function toSource(r: Rect | { x: number; y: number; width: number; height: number }, scale: number, crop: Crop): Rect | undefined {
	const w = "width" in r ? r.width : r.w;
	const h = "height" in r ? r.height : r.h;
	const x0 = Math.max(0, r.x * scale - crop.x);
	const y0 = Math.max(0, r.y * scale - crop.y);
	const x1 = Math.min(crop.w, (r.x + w) * scale - crop.x);
	const y1 = Math.min(crop.h, (r.y + h) * scale - crop.y);
	return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : undefined;
}

/** Gap between `t` and the window [from, to]: 0 inside it. */
const distance = (t: number, from: number, to: number) => (t < from ? from - t : t > to ? t - to : 0);

/**
 * The OCR line a text names. Case-insensitive substring; the tightest line (fewest extra characters) wins, then the
 * most confident. Two lines equally good are ambiguous: guessing would put the camera on the wrong thing.
 */
export function bestLine(lines: TextBox[], text: string): TextBox {
	const want = text.toLowerCase();
	const seen = () => lines.map((l) => `  "${l.text}"`).join("\n") || "  (no text found)";
	const hits = lines.filter((l) => l.text.toLowerCase().includes(want));
	if (!hits.length) throw new StudioError(`focus text "${text}" is not on screen`, `OCR found:\n${seen()}`);
	const rank = (l: TextBox) => l.text.length - want.length;
	const best = hits.reduce((a, b) => (rank(b) < rank(a) || (rank(b) === rank(a) && b.conf > a.conf) ? b : a));
	const ties = hits.filter((l) => rank(l) === rank(best) && l.conf === best.conf);
	if (ties.length > 1)
		throw new StudioError(`focus text "${text}" is ambiguous: ${ties.length} equally good lines`, `Name a longer text or use a selector. OCR found:\n${seen()}`);
	return best;
}

function fromTimeline(scene: FocusScene, f: NonNullable<FocusScene["focus"]>[number], timeline: Timeline | undefined, path: string | undefined): ResolvedFocus {
	if (!timeline)
		throw new StudioError(
			`focus "${f.id}" names selector ${f.selector}, but ${scene.clip} has no timeline`,
			"Record it with `bun studio run` (its timeline carries the recipe's `focus` steps), or give the focus a `text` or a `rect`."
		);
	const matches = timeline.focus.filter((h) => h.selector === f.selector);
	if (!matches.length) {
		const have = [...new Set(timeline.focus.map((h) => h.selector))];
		throw new StudioError(
			`focus "${f.id}": ${path} has no focus step for ${f.selector}`,
			have.length ? `Its focus steps are: ${have.join(", ")}.` : "It has no focus steps: add `{ do: \"focus\", target, ms }` to the recipe and re-record."
		);
	}
	// `at` is scene-local, hint times are on the clip's own clock: the viewer needs the text at clip time from+at.
	const clipMs = (scene.from + f.at) * 1000;
	const hint = matches.reduce((a, b) => (distance(clipMs, b.t, b.t + b.ms) < distance(clipMs, a.t, a.t + a.ms) ? b : a));
	const rect = toSource(hint.target, timeline.size.scale, scene.crop);
	if (!rect)
		throw new StudioError(`focus "${f.id}": ${f.selector} is outside the scene's crop`, `its rect ${JSON.stringify(hint.target)} css px, crop ${JSON.stringify(scene.crop)} source px`);
	const label = f.label ?? hint.label;
	const textPx = f.textPx ?? hint.textPx;
	return { ...f, rect, via: "timeline", ...(label !== undefined ? { label } : {}), ...(textPx !== undefined ? { textPx } : {}) };
}

/** OCR of the source frame at `clipSec` (full frame, source px), cached by video hash + time + text. */
async function ocrRect(video: string, clipSec: number, text: string): Promise<Rect> {
	const key = sha256(`${await sha256File(video)}|${clipSec.toFixed(3)}|${text.toLowerCase()}`);
	const cached = join(CACHE, "focus", `${key}.json`);
	if (existsSync(cached)) return JSON.parse(readFileSync(cached, "utf8")) as Rect;
	const frame = join(CACHE, "focus", `${key}.png`);
	mkdirSync(dirname(frame), { recursive: true });
	await ffmpeg(["-ss", clipSec.toFixed(3), "-i", video, "-frames:v", "1", frame]);
	const { boxes } = await ocr(frame);
	const rect = bestLine(boxes, text).rect;
	writeFileSync(cached, JSON.stringify(rect));
	return rect;
}

/**
 * Resolve a scene's focuses to rects in source px of its crop. `selector` uses the recording's timeline, `rect` is
 * taken as given, `text` falls back to OCR of the frame at `from + at`.
 */
export async function resolveFocuses(scene: FocusScene, opts: ResolveOpts = {}): Promise<ResolvedFocus[]> {
	const out: ResolvedFocus[] = [];
	let timeline: Timeline | undefined;
	let timelinePath: string | undefined;
	for (const f of scene.focus ?? []) {
		if (f.selector !== undefined) {
			if (!timeline) {
				timelinePath = "timeline" in opts ? opts.timeline : timelineOfClip(scene.clip);
				timeline = timelinePath ? readTimeline(timelinePath) : undefined;
			}
			out.push(fromTimeline(scene, f, timeline, timelinePath));
		} else if (f.rect !== undefined) {
			out.push({ ...f, rect: f.rect, via: "rect" });
		} else if (f.text !== undefined) {
			const full = await ocrRect(opts.video ?? assetPath(scene.clip), scene.from + f.at, f.text);
			const rect = toSource(full, 1, scene.crop);
			if (!rect) throw new StudioError(`focus "${f.id}": text "${f.text}" is outside the scene's crop`);
			out.push({ ...f, rect, via: "ocr" });
		} else {
			throw new StudioError(`focus "${f.id}" says nothing about where it is`, "Give it a `selector` (a recipe focus step), a `text` (found by OCR) or a `rect` (source px).");
		}
	}
	return out;
}
