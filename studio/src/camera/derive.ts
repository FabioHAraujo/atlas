// The I/O boundary of the virtual camera: the real focus resolver for a film's cuts, `camera.json` (the only file
// `studio fix --apply` writes), and the sidecar (`<cut>.camera.json`) the render leaves for the lint.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FILMS, StudioError } from "../lib/paths.ts";
import type { AppClipScene, Cut, Film, Scene } from "../lib/types.ts";
import { profileFor } from "../lint/profiles.ts";
import { resolveFocuses } from "./focus.ts";
import { planCamera } from "./plan.ts";
import { type CameraOverrides, RECORDING_SCALE, reframeCut, type ResolveFocus, safeRectFor } from "./reframe.ts";
import { type CameraSidecar, DEFAULT_LIMITS, type ShotPlan } from "./types.ts";

/** The film's camera overrides file: `films/<id>/camera.json`. */
export const overridesPath = (filmId: string): string => join(FILMS, filmId, "camera.json");

/** Overrides keyed `<cut.out>/<scene id>/<focus id>`. A missing file is no overrides; a bad zoom is refused by key. */
export function loadOverrides(file: string): CameraOverrides {
	if (!existsSync(file)) return {};
	const raw = JSON.parse(readFileSync(file, "utf8")) as { version?: number; overrides?: Record<string, { zoom?: unknown }> };
	if (raw.version !== 1 || typeof raw.overrides !== "object" || raw.overrides === null) throw new StudioError(`${file} is not a camera.json (version 1)`, "it is written by `bun studio fix <film> --apply`");
	for (const [key, v] of Object.entries(raw.overrides)) {
		if (typeof v?.zoom !== "number" || !Number.isFinite(v.zoom) || v.zoom < 1) throw new StudioError(`${file}: override "${key}" needs a zoom >= 1, got ${JSON.stringify(v?.zoom)}`, "delete the entry to go back to the planned zoom");
	}
	return raw.overrides as CameraOverrides;
}

/** Sorted keys and a trailing newline: equal data, equal bytes, clean diffs. */
export function saveOverrides(file: string, overrides: CameraOverrides): void {
	const sorted = Object.fromEntries(Object.entries(overrides).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
	writeFileSync(file, `${JSON.stringify({ version: 1, overrides: sorted }, null, "\t")}\n`);
}

/** `next` wins per focus; everything else stays. */
export const mergeOverrides = (prev: CameraOverrides, next: CameraOverrides): CameraOverrides => ({ ...prev, ...next });

/** The real resolver: the recording's timeline `focus` hints, or OCR of a frame. */
export const resolveReal: ResolveFocus = (scene, focus) => {
	if (scene.type !== "app") throw new StudioError(`${scene.id}: terminal scenes have no focus resolver yet`, "give the focus a `rect` in take pixels");
	return resolveFocuses({ ...scene, focus });
};

/** The film's renditions with scenes and camera planned from its sources and camera.json. */
export async function deriveRenditions(film: Film, overrides: CameraOverrides = loadOverrides(overridesPath(film.id))): Promise<Cut[]> {
	const out: Cut[] = [];
	for (const cut of film.renditions ?? []) out.push(await reframeCut(film, cut, resolveReal, overrides));
	return out;
}

const isCameraApp = (s: Scene): s is AppClipScene & Required<Pick<AppClipScene, "camera" | "viewport">> => s.type === "app" && !!s.camera && !!s.viewport;

/**
 * What the camera did in each shot, in the OUTPUT's own pixels and the CUT's own seconds: the lint's ground truth for
 * speed, subject-in-frame and focus windows. `starts` is `Compiled.starts` (scene id -> start second in the cut).
 */
export function sidecarFor(film: Film, cut: Cut, starts: Record<string, number>): CameraSidecar {
	const profile = profileFor(cut.reframe?.profile ?? "social-vertical");
	const frame = cut.aspect === "9:16" ? { w: 1080, h: 1920 } : cut.aspect === "4:5" ? { w: 1080, h: 1350 } : cut.aspect === "1:1" ? { w: 1080, h: 1080 } : { w: 1920, h: 1080 };
	const shots: ShotPlan[] = cut.scenes.map((s) => {
		const start = starts[s.id] ?? 0;
		const base: ShotPlan = { id: s.id, start, end: +(start + s.duration).toFixed(4), keys: [], focuses: [], limits: DEFAULT_LIMITS };
		// a terminal take in a viewport is a still shot: the viewport tells the lint its text is the take's own
		if (s.type === "terminal" && s.viewport) return { ...base, viewport: s.viewport };
		if (!isCameraApp(s)) return base;
		const geometry = { source: { w: s.crop.w, h: s.crop.h }, viewport: s.viewport, frame, scale: RECORDING_SCALE };
		const planned = planCamera(geometry, { minTextPx: profile.minFocusTextPx ?? profile.minTextPx, displayHeight: profile.displayHeight }, DEFAULT_LIMITS, s.camera.focuses, s.duration, { zoomOverrides: zoomsOf(s), safe: safeRectFor(cut.aspect, cut.reframe?.profile ?? "social-vertical") });
		const labels = new Map(s.camera.focuses.map((f) => [f.id, f.label]));
		return {
			...base,
			viewport: s.viewport,
			source: geometry.source,
			scale: RECORDING_SCALE,
			keys: s.camera.keys,
			focuses: planned.report.map((r) => ({ id: r.id, ...(labels.get(r.id) ? { label: labels.get(r.id)! } : {}), from: +(start + r.from).toFixed(4), to: +(start + r.to).toFixed(4), rect: r.outRect, zoom: r.zoom, neededZoom: r.neededZoom, shownTextPx: r.shownTextPx, textPx: r.textPx })),
		};
	});
	return { version: 1, film: film.id, cut: cut.out, aspect: cut.aspect, frame, fps: film.fps, shots };
}

/** The zoom each focus ended up with: the camera's key for it (so the sidecar reflects overrides, not a re-derivation). */
function zoomsOf(s: AppClipScene & { camera: NonNullable<AppClipScene["camera"]> }): Record<string, number> {
	const z: Record<string, number> = {};
	for (const k of s.camera.keys) if (k.focus) z[k.focus] = k.zoom;
	return z;
}
