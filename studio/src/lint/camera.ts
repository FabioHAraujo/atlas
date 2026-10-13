// The camera rules of the video LSP. A social cut `<dir>/<cut>.mp4` has the sidecar `<dir>/<cut>.camera.json` the render
// wrote (CameraSidecar): what the virtual camera did, in the output's own pixels. The rules here are pure functions of
// (sidecar, profile) and return Diagnostics; only `scanFocuses` touches the video (one frame per focus, then OCR).
//
// Every number a rule compares against is the profile's or the shot's own limit, never a constant of the rule; every
// fix is machine-applicable (`slow-camera`, `set-camera-zoom`, ... in types.ts) so lint -> fix -> lint converges.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MAX_UPSCALE, poseAt, toOutput } from "../camera/plan.ts";
import type { CameraSidecar, CaptionCue, FocusPlan, ShotPlan } from "../camera/types.ts";
import { run } from "../lib/exec.ts";
import { StudioError } from "../lib/paths.ts";
import { type Overflow, overflow, safeRect } from "./checks-image.ts";
import { hasTesseract, ocr, type TextBox } from "./ocr.ts";
import type { Diagnostic, LintReport, Profile, Rect } from "./types.ts";

/** poseAt is sampled at the video's own cadence: a move cannot hide a spike between samples at 60 Hz. */
const SAMPLE_HZ = 60;
/** The planner stretches a move so its PEAK speed equals the limit; sampling and rounding may land a hair above it. */
const TOLERANCE = 1.05;
/** Recomputed geometry carries float noise; a rect "on the edge" is inside. */
const EPS = 0.01;
/** The OCR boxes of a focus are looked for in its rect grown by this fraction per side (text overshoots its element). */
const FOCUS_GROW = 0.12;
/** The fix asks for 5% more than strictly needed: OCR bands jitter by a pixel or two. */
const ZOOM_MARGIN = 1.05;
/** `shown` is band x displayHeight / frameH: a band that is exactly the limit comes back a hair under it in floating point. */
const SHOWN_SLACK = 1e-6;

const SIDES = ["top", "bottom", "left", "right"] as const;

const r2 = (n: number) => Math.round(n * 100) / 100;
const ceil2 = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;
const floor2 = (n: number) => Math.floor(n * 100 + 1e-9) / 100;
const sidesOf = (o: Overflow) => SIDES.filter((s) => o[s] > EPS).map((s) => `${s} by ${Math.max(1, Math.round(o[s]))}px`);

// ── the sidecar ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** `v` is an object whose listed properties have the listed type ("number" also demands a finite value). */
function has(v: unknown, fields: Record<string, "number" | "string" | "array">): boolean {
	if (typeof v !== "object" || v === null) return false;
	return Object.entries(fields).every(([name, kind]) => {
		const x: unknown = Object.getOwnPropertyDescriptor(v, name)?.value;
		return kind === "array" ? Array.isArray(x) : kind === "number" ? typeof x === "number" && Number.isFinite(x) : typeof x === "string";
	});
}

const isSize = (v: unknown) => has(v, { w: "number", h: "number" });
const isRect = (v: unknown) => has(v, { x: "number", y: "number", w: "number", h: "number" });

/** `<cut>.mp4` -> `<cut>.camera.json` */
export const sidecarPath = (file: string): string => `${file.replace(/\.[^./\\]+$/, "")}.camera.json`;

/** The sidecar next to `file`: undefined when the cut has none, StudioError when it is there but not a version-1 sidecar. */
export function loadSidecar(file: string): CameraSidecar | undefined {
	const path = sidecarPath(file);
	if (!existsSync(path)) return undefined;
	const bad = (why: string): never => {
		throw new StudioError(`${path} is not a camera sidecar: ${why}`, "re-render the cut (bun studio film <id> --cut <cut>) to rewrite it");
	};
	let raw: unknown;
	try {
		raw = JSON.parse(readFileSync(path, "utf8"));
	} catch (e) {
		return bad((e as Error).message);
	}
	if (!has(raw, { version: "number", shots: "array" })) return bad("needs version, frame {w,h} and shots[]");
	const sc = raw as CameraSidecar; // `has` proved version and shots; the rest is checked below, the shape is the writer's own (camera/types.ts)
	if (!isSize(sc.frame)) bad("needs frame {w,h}");
	if (sc.version !== 1) bad(`version must be 1, found ${sc.version}`);
	for (const s of sc.shots) {
		const at = `shot ${JSON.stringify(s?.id)}`;
		if (!has(s, { id: "string", start: "number", end: "number", keys: "array", focuses: "array" })) bad(`${at} needs id, start, end, keys[], focuses[]`);
		if (!s.keys.every((k) => has(k, { t: "number", x: "number", y: "number", zoom: "number", move: "number", ease: "string" }))) bad(`${at}: keys must be camera keys (t, x, y, zoom, ease, move)`);
		if (!s.focuses.every((f) => has(f, { id: "string", from: "number", to: "number", zoom: "number" }) && isRect(f.rect))) bad(`${at}: focuses must carry id, from, to, rect, zoom`);
		if (!has(s.limits, { maxPanPxPerSec: "number", maxZoomPerSec: "number" })) bad(`${at}: limits.maxPanPxPerSec and limits.maxZoomPerSec are required`);
		if (s.viewport !== undefined && !isRect(s.viewport)) bad(`${at}: viewport must be a rect`);
		if (s.source !== undefined && !isSize(s.source)) bad(`${at}: source must be {w,h}`);
	}
	if (sc.captions !== undefined && !(Array.isArray(sc.captions) && sc.captions.every((c) => has(c, { start: "number", end: "number", text: "string", lines: "array" }) && isRect(c.rect)))) bad("captions must carry start, end, text, lines, rect");
	return sc;
}

// ── camera/too-fast ─────────────────────────────────────────────────────────────────────────────────────────────────

interface Peak {
	value: number;
	/** first and last sample interval (scene seconds) over the limit */
	from: number;
	to: number;
}

/**
 * The viewport center's speed (output px/s) and the zoom rate (e-folds/s) of every move, recomputed from the keys by
 * sampling `poseAt` at 60 Hz, against the SHOT's own limits (the planner may have been run with other ones).
 * Cuts (`move` 0) are not motion. The fix scales the move's duration: speed is inversely proportional to it for a given
 * easing curve, so `move * peak / limit` makes the peak exactly the limit whatever the curve is.
 */
export function checkCameraSpeed(sc: CameraSidecar): Diagnostic[] {
	const out: Diagnostic[] = [];
	for (const shot of sc.shots) {
		const { keys, limits } = shot;
		const fit = shot.viewport && shot.source ? shot.viewport.w / shot.source.w : undefined;
		for (let i = 1; i < keys.length; i++) {
			const k = keys[i]!;
			if (k.move <= 0 || k.ease === "cut") continue;
			const n = Math.max(1, Math.ceil(k.move * SAMPLE_HZ));
			const dt = k.move / n;
			const pan: Peak = { value: 0, from: NaN, to: NaN };
			const zoom: Peak = { value: 0, from: NaN, to: NaN };
			let prev = poseAt(keys, k.t);
			for (let j = 1; j <= n; j++) {
				const t = k.t + dt * j;
				const p = poseAt(keys, t);
				const speeds: Array<[Peak, number, number]> = [
					[pan, fit === undefined ? 0 : (Math.hypot(p.x - prev.x, p.y - prev.y) * fit * Math.max(prev.zoom, p.zoom)) / dt, limits.maxPanPxPerSec],
					[zoom, Math.abs(Math.log(p.zoom / prev.zoom)) / dt, limits.maxZoomPerSec],
				];
				for (const [peak, v, limit] of speeds) {
					peak.value = Math.max(peak.value, v);
					if (v <= limit * TOLERANCE) continue;
					if (Number.isNaN(peak.from)) peak.from = t - dt;
					peak.to = t;
				}
				prev = p;
			}
			for (const [peak, limit, what, unit] of [
				[pan, limits.maxPanPxPerSec, "the viewport center moves", "px/s"],
				[zoom, limits.maxZoomPerSec, "the zoom changes", " e-folds/s"],
			] as const) {
				if (Number.isNaN(peak.from)) continue;
				const minMoveSeconds = ceil2((k.move * peak.value) / limit);
				out.push({
					severity: "error",
					code: "camera/too-fast",
					message: `shot "${shot.id}": ${what} at ${peak.value.toFixed(unit === "px/s" ? 0 : 2)}${unit} (limit ${limit}${unit}) between ${r2(shot.start + peak.from)}s and ${r2(shot.start + peak.to)}s; a viewer cannot follow it`,
					range: { start: r2(shot.start + peak.from), end: r2(shot.start + peak.to) },
					measured: +peak.value.toFixed(unit === "px/s" ? 1 : 3),
					limit,
					fix: { action: "slow-camera", description: `take at least ${minMoveSeconds}s for the move that starts at ${r2(shot.start + k.t)}s (now ${r2(k.move)}s)`, params: { shot: shot.id, minMoveSeconds } },
				});
			}
		}
	}
	return out;
}

// ── camera/focus-late ───────────────────────────────────────────────────────────────────────────────────────────────

/** Slack for a focus that ends a frame or so past the shot: the planner's floats and the sidecar's rounding. */
const END_SLACK = 0.01;
/** The retime fix lands the focus this much earlier than the last moment that still fits (keeps the cut off the hold's last frame). */
const RETIME_MARGIN = 0.05;

/** Whether the focus' readable window begins before its shot ends; later, the frames are the NEXT scene's. */
const startsInShot = (shot: ShotPlan, f: FocusPlan): boolean => f.from < shot.end;

/**
 * A focus whose readable window ends after its shot can never be read in full: the planner delays a focus the camera
 * cannot reach and settle on in time (it never rushes past a limit), so a crowded list pushes the later ones past the
 * end. No camera setting cures it, the focus has to be asked earlier: `latestAt` is the latest `at` (scene seconds)
 * for which move-end + settle + hold still fits, assuming the camera is free by then.
 */
export function checkFocusLate(sc: CameraSidecar): Diagnostic[] {
	const out: Diagnostic[] = [];
	for (const shot of sc.shots) {
		for (const f of shot.focuses) {
			if (f.to <= shot.end + END_SLACK) continue;
			const latestAt = r2(shot.end - (f.to - f.from) - shot.limits.settle - RETIME_MARGIN);
			out.push({
				severity: "error",
				code: "camera/focus-late",
				message: `shot "${shot.id}": focus "${f.id}" is readable from ${r2(f.from)}s to ${r2(f.to)}s but the shot ends at ${r2(shot.end)}s; the camera cannot get there in time`,
				rect: f.rect,
				range: { start: r2(f.from), end: shot.end },
				measured: r2(f.to),
				limit: shot.end,
				fix: { action: "retime-focus", description: `ask "${f.id}" at ${latestAt}s or earlier (or drop a focus before it): it needs the camera ${r2(shot.limits.settle)}s settled and ${r2(f.to - f.from)}s of hold inside the shot`, params: { shot: shot.id, focus: f.id, latestAt } },
			});
		}
	}
	return out;
}

// ── camera/subject-out-of-frame, safe-area/caption ──────────────────────────────────────────────────────────────────

/**
 * The focus rect (output px) at the instants the viewer must read it. The sidecar carries the rect at the HOLD pose
 * (the key labelled with the focus); its source rect is recovered from that pose and re-projected through `poseAt` at
 * 60 Hz over [from,to], so a camera that is still moving while the text must be read is caught, not trusted.
 * Without viewport/source/key there is nothing to re-project and the declared rect stands.
 */
function focusRects(shot: ShotPlan, f: FocusPlan): Rect[] {
	const hold = shot.keys.find((k) => k.focus === f.id);
	if (!shot.viewport || !shot.source || !hold) return [f.rect];
	const fit = shot.viewport.w / shot.source.w;
	const s0 = fit * hold.zoom;
	const cx = shot.viewport.x + shot.viewport.w / 2;
	const cy = shot.viewport.y + shot.viewport.h / 2;
	const src = { x: hold.x + (f.rect.x - cx) / s0, y: hold.y + (f.rect.y - cy) / s0, w: f.rect.w / s0, h: f.rect.h / s0 };
	const geometry = { source: shot.source, viewport: shot.viewport, frame: { w: 0, h: 0 }, scale: shot.scale ?? 1 };
	const n = Math.max(1, Math.ceil((f.to - f.from) * SAMPLE_HZ));
	return Array.from({ length: n + 1 }, (_, j) => toOutput(geometry, poseAt(shot.keys, f.from + ((f.to - f.from) * j) / n - shot.start), src));
}

const worst = (rects: Rect[], inside: Rect): Overflow =>
	rects.map((r) => overflow(r, inside)).reduce((a, b) => ({ top: Math.max(a.top, b.top), bottom: Math.max(a.bottom, b.bottom), left: Math.max(a.left, b.left), right: Math.max(a.right, b.right) }));

/**
 * Every focus rect must lie inside the shot's viewport (the camera shows it) and inside the profile's safe rect (no
 * platform UI covers it), for the whole time it must be readable. When it does not fit the viewport because the zoom is
 * too high, the fix is the largest zoom at which it does (output size is linear in zoom).
 */
export function checkCameraSubjects(sc: CameraSidecar, profile: Profile): Diagnostic[] {
	const out: Diagnostic[] = [];
	const safe = profile.safe ? safeRect(sc.frame, profile.safe) : undefined;
	for (const shot of sc.shots) {
		for (const f of shot.focuses) {
			const rects = focusRects(shot, f);
			const range = { start: r2(f.from), end: r2(f.to) };
			const vp = shot.viewport;
			const outsideView = vp ? sidesOf(worst(rects, vp)) : [];
			if (vp && outsideView.length > 0) {
				const zoom = floor2(f.zoom * Math.min(vp.w / f.rect.w, vp.h / f.rect.h));
				const tooBig = f.rect.w > vp.w + EPS || f.rect.h > vp.h + EPS;
				out.push({
					severity: "error",
					code: "camera/subject-out-of-frame",
					message: `shot "${shot.id}": focus "${f.id}" leaves the camera's viewport (${outsideView.join(", ")}) while it must be readable`,
					rect: f.rect,
					range,
					fix: tooBig && zoom >= 1 ? { action: "set-camera-zoom", description: `zoom ${zoom} is the largest at which "${f.id}" fits the viewport (now ${r2(f.zoom)})`, params: { shot: shot.id, focus: f.id, zoom } } : undefined,
				});
			}
			const outsideSafe = safe ? sidesOf(worst(rects, safe)) : [];
			if (safe && outsideSafe.length > 0) {
				out.push({
					severity: "error",
					code: "camera/subject-out-of-frame",
					message: `shot "${shot.id}": focus "${f.id}" enters the ${profile.id} UI zone (${outsideSafe.join(", ")}); platform overlays will cover it`,
					rect: f.rect,
					range,
					fix: { action: "move-out-of-safe-zone", description: `keep the focus inside x ${safe.x}-${safe.x + safe.w}, y ${safe.y}-${safe.y + safe.h}`, params: { x: safe.x, y: safe.y, w: safe.w, h: safe.h } },
				});
			}
		}
	}
	return out;
}

/** Burned-in captions must stay out of the platform UI; names the platforms whose own zone each cue hits. */
export function checkCaptionSafeArea(sc: CameraSidecar, profile: Profile): Diagnostic[] {
	if (!profile.safe || !sc.captions) return [];
	const safe = safeRect(sc.frame, profile.safe);
	const out: Diagnostic[] = [];
	for (const c of sc.captions) {
		const sides = sidesOf(overflow(c.rect, safe));
		if (sides.length === 0) continue;
		const hit = Object.entries(profile.platforms ?? {})
			.filter(([, zones]) => sidesOf(overflow(c.rect, safeRect(sc.frame, zones))).length > 0)
			.map(([name]) => name);
		out.push({
			severity: "error",
			code: "safe-area/caption",
			message: `caption "${c.text}" enters the ${hit.length > 0 ? hit.join(", ") : profile.id} UI zone (${sides.join(", ")}); platform overlays will cover it`,
			rect: c.rect,
			range: { start: c.start, end: c.end },
			fix: { action: "move-out-of-safe-zone", description: `keep captions inside x ${safe.x}-${safe.x + safe.w}, y ${safe.y}-${safe.y + safe.h}`, params: { x: safe.x, y: safe.y, w: safe.w, h: safe.h } },
		});
	}
	return out;
}

// ── captions/* ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** Reading speed, line length, line count, duration and gaps of the burned-in captions, against the profile's rules. */
export function checkCaptionText(sc: CameraSidecar, profile: Profile): Diagnostic[] {
	const rules = profile.captions;
	if (!rules || !sc.captions) return [];
	const out: Diagnostic[] = [];
	const fix = (what: string): Diagnostic["fix"] => ({ action: "rechunk-captions", description: `re-split the captions: ${what} (at most ${rules.maxCps} chars/s, ${rules.maxCharsPerLine} chars per line, ${rules.maxLines} lines)`, params: { maxCps: rules.maxCps, maxCharsPerLine: rules.maxCharsPerLine } });
	const error = (code: string, message: string, c: CaptionCue, measured: number, limit: number, range = { start: c.start, end: c.end }): void => {
		out.push({ severity: "error", code, message: `caption "${c.text}": ${message}`, rect: c.rect, range, measured: +measured.toFixed(2), limit, fix: fix(message) });
	};
	const cues = [...sc.captions].sort((a, b) => a.start - b.start);
	cues.forEach((c, i) => {
		const dur = c.end - c.start;
		const cps = c.text.length / dur;
		if (dur > 0 && cps > rules.maxCps) error("captions/cps", `${cps.toFixed(1)} chars/s is faster than ${rules.maxCps}`, c, cps, rules.maxCps);
		const longest = Math.max(0, ...c.lines.map((l) => l.length));
		if (longest > rules.maxCharsPerLine) error("captions/line-length", `a line has ${longest} chars (max ${rules.maxCharsPerLine})`, c, longest, rules.maxCharsPerLine);
		if (c.lines.length > rules.maxLines) error("captions/lines", `${c.lines.length} lines (max ${rules.maxLines})`, c, c.lines.length, rules.maxLines);
		if (dur < rules.minDuration - 1e-9) error("captions/duration", `${dur.toFixed(2)}s on screen is shorter than ${rules.minDuration}s`, c, dur, rules.minDuration);
		const next = cues[i + 1];
		if (!next) return;
		const gap = next.start - c.end;
		if (gap < -1e-9) error("captions/gap", `overlaps the next caption by ${(-gap).toFixed(2)}s`, c, gap, 0, { start: next.start, end: c.end });
		else if (gap > 1e-9 && gap < rules.minGap - 1e-9) error("captions/gap", `${gap.toFixed(3)}s to the next caption is shorter than ${rules.minGap}s (it reads as a flicker)`, c, gap, rules.minGap, { start: c.end, end: next.start });
	});
	return out;
}

// ── text/too-small-for-target: the rendered frames ──────────────────────────────────────────────────────────────────

/** The OCR boxes found on the frame in the middle of one focus' readable window. */
export interface FocusScan {
	shot: ShotPlan;
	focus: FocusPlan;
	boxes: TextBox[];
}

/**
 * The smallest glyph band of the text in each focus, MEASURED on the rendered frame (the planner's estimate is not
 * evidence). `shown = band * displayHeight / frameH` is the same measure as checkTextSize, against the profile's
 * `minFocusTextPx`: error below 0.6x the minimum, warning otherwise. The fix is the zoom that would reach the minimum
 * (the focus' zoom x limit/shown, with margin) unless the recording's resolution caps the zoom below it: then only a
 * bigger text in the source helps. A focus with no text at all points the camera at the wrong place.
 */
export function checkFocusText(sc: CameraSidecar, profile: Profile, scans: FocusScan[]): Diagnostic[] {
	const min = profile.minFocusTextPx;
	if (min === undefined) return [];
	const out: Diagnostic[] = [];
	const k = profile.displayHeight / sc.frame.h;
	for (const { shot, focus: f, boxes } of scans) {
		if (!startsInShot(shot, f)) continue;
		const range = { start: r2(f.from), end: r2(f.to) };
		const gx = f.rect.w * FOCUS_GROW;
		const gy = f.rect.h * FOCUS_GROW;
		const x0 = Math.max(0, f.rect.x - gx);
		const y0 = Math.max(0, f.rect.y - gy);
		const x1 = Math.min(sc.frame.w, f.rect.x + f.rect.w + gx);
		const y1 = Math.min(sc.frame.h, f.rect.y + f.rect.h + gy);
		const found = boxes.filter((b) => b.conf >= 0.5 && b.text.trim().length >= 3 && b.rect.x >= x0 && b.rect.y >= y0 && b.rect.x + b.rect.w <= x1 && b.rect.y + b.rect.h <= y1);
		if (found.length === 0) {
			out.push({
				severity: "warning",
				code: "text/focus-empty",
				message: `shot "${shot.id}": focus "${f.id}" declared ${f.textPx}px text but OCR finds none in its rect; the camera is pointing at the wrong place`,
				rect: f.rect,
				range,
			});
			continue;
		}
		const small = found.reduce((a, b) => (b.rect.h < a.rect.h ? b : a));
		const shown = small.rect.h * k;
		if (shown >= min - SHOWN_SLACK) continue;
		const zoom = r2(f.zoom * (min / shown) * ZOOM_MARGIN);
		const cap = shot.viewport && shot.source ? r2(MAX_UPSCALE / (shot.viewport.w / shot.source.w)) : undefined;
		const base = { shot: shot.id, focus: f.id };
		const camera = cap === undefined || zoom <= cap;
		out.push({
			severity: shown < min * 0.6 ? "error" : "warning",
			code: "text/too-small-for-target",
			message: `shot "${shot.id}": "${small.text}" in focus "${f.id}" is ${shown.toFixed(1)}px tall at ${profile.displayHeight}px display height (min ${min}px for ${profile.id})`,
			rect: small.rect,
			range,
			measured: +shown.toFixed(1),
			limit: min,
			fix: camera
				? { action: "set-camera-zoom", description: `zoom ${zoom} (now ${r2(f.zoom)}) makes the text ${min}px tall`, params: cap === undefined ? { ...base, zoom } : { ...base, zoom, maxZoom: cap } }
				: { action: "enlarge-source-text", description: `${zoom}x zoom is needed but the recording supports ${cap}x (${MAX_UPSCALE} output px per source px): make the text bigger in the app or focus something larger`, params: { ...base, neededZoom: zoom, maxZoom: cap } },
		});
	}
	return out;
}

/** One frame per focus (the middle of its readable window) through `ocrFn`; a focus that starts after its shot has no frame of its own. */
export async function scanFocuses(file: string, sc: CameraSidecar, ocrFn: (png: string) => Promise<{ boxes: TextBox[] }> = ocr): Promise<FocusScan[]> {
	const tmp = mkdtempSync(join(tmpdir(), "lint-camera-"));
	try {
		const scans: FocusScan[] = [];
		for (const shot of sc.shots) {
			for (const focus of shot.focuses.filter((f) => startsInShot(shot, f))) {
				const png = join(tmp, `${shot.id}-${focus.id}.png`.replace(/[^\w.-]/g, "_"));
				await run(["ffmpeg", "-v", "error", "-y", "-ss", String((focus.from + focus.to) / 2), "-i", file, "-frames:v", "1", png]);
				scans.push({ shot, focus, boxes: (await ocrFn(png)).boxes });
			}
		}
		return scans;
	} finally {
		rmSync(tmp, { recursive: true, force: true });
	}
}

/** The deterministic rules: no video needed. */
export const checkCamera = (sc: CameraSidecar, profile: Profile): Diagnostic[] => [...checkCameraSpeed(sc), ...checkFocusLate(sc), ...checkCameraSubjects(sc, profile), ...checkCaptionSafeArea(sc, profile), ...checkCaptionText(sc, profile)];

/** Everything the sidecar of `file` asks for; no sidecar, no camera rules. `fast` skips the OCR of the rendered frames. */
/** The cut times the generic frame rules look at: the middle of every shot of a camera cut, else the 25/50/75% stills. */
export function sampleTimes(sc: CameraSidecar | undefined, duration: number): number[] {
	if (!sc) return [0.25, 0.5, 0.75].map((f) => duration * f);
	return sc.shots.map((s) => +((s.start + s.end) / 2).toFixed(3));
}

/**
 * What is on screen at cut time `t`: a "picture" (a recording under a camera viewport), a "card" (a shot with no picture:
 * title, end card) or a plain "frame" (no sidecar, or outside every shot). The window-edge rules judge a window, so they
 * run on pictures and plain frames only: on a card the subject detector joins unrelated text blocks into one 'subject'.
 */
export function frameKindAt(sc: CameraSidecar | undefined, t: number): "picture" | "card" | "frame" {
	const shot = sc?.shots.find((s) => t >= s.start && t < s.end);
	return !shot ? "frame" : shot.viewport ? "picture" : "card";
}

/** Viewports of the camera shots on screen at cut time `t` (a shot without a camera has none). */
export function viewportsAt(sc: CameraSidecar, t: number): Rect[] {
	return sc.shots.filter((s) => s.viewport && t >= s.start && t < s.end).map((s) => s.viewport!);
}

/**
 * The OCR boxes that are NOT the app's own text. A box mostly inside a camera viewport (>= 50% of its area) is the
 * recording's typography, including a line the camera crops at the viewport's edge: the camera enlarges it only where a
 * focus asks (judged by `text/too-small-for-target`). A box mostly outside is a headline or caption laid over the picture
 * and stays under the generic rules.
 */
export function outsideViewports<T extends { rect: Rect }>(boxes: T[], viewports: Rect[]): T[] {
	const share = (r: Rect, v: Rect) => {
		const w = Math.min(r.x + r.w, v.x + v.w) - Math.max(r.x, v.x);
		const h = Math.min(r.y + r.h, v.y + v.h) - Math.max(r.y, v.y);
		return w > 0 && h > 0 ? (w * h) / (r.w * r.h) : 0;
	};
	return boxes.filter((b) => !viewports.some((v) => share(b.rect, v) >= 0.5));
}

export async function lintCameraFile(file: string, profile: Profile, report: LintReport, fast = false): Promise<void> {
	const sc = loadSidecar(file);
	if (!sc) return;
	report.diagnostics.push(...checkCamera(sc, profile));
	if (fast || !sc.shots.some((s) => s.focuses.some((f) => startsInShot(s, f)))) return;
	if (process.platform !== "darwin" && !(await hasTesseract())) {
		report.skipped.push({ check: "text/too-small-for-target", reason: "no OCR engine (tesseract or macOS Vision)" });
		return;
	}
	try {
		report.diagnostics.push(...checkFocusText(sc, profile, await scanFocuses(file, sc)));
	} catch (e) {
		report.skipped.push({ check: "text/too-small-for-target", reason: `OCR of the focus frames failed: ${(e as Error).message}` });
	}
}
