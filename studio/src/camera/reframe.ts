// Reframe: one film, one set of scenes, a cut per rendition. `reframeCut` takes the film's source cut (the 16:9 one,
// whose app scenes carry `focus` lists) and a derived cut (`Cut.reframe`) and returns that cut's scenes re-laid-out
// for its aspect with the virtual camera PLANNED from each scene's focuses (plan.ts). Pure but for the injected
// `resolve` (finding a focus' rect needs the recording's timeline or OCR of a frame, see focus.ts).
//
// Nothing here is a pixel pushed by hand: the layout is a fixed budget per aspect (headline band, viewport, caption
// band, all inside the profile's safe area), the camera is a function of the legibility floor, and the only knob an
// agent turns is `camera.json` (zoom overrides written by `studio fix`).

import { ASPECTS, type AspectId, type AppClipScene, type Cut, type Film, type Rect, type Scene, type TerminalScene, type TitleScene } from "../lib/types.ts";
import { profileFor } from "../lint/profiles.ts";
import { planCamera, type PlannedCamera } from "./plan.ts";
import { DEFAULT_LIMITS, type Camera, type CameraLimits, type Focus, type Frame, GLYPH_BAND, type ResolvedFocus } from "./types.ts";

/** Finds where each focus is in the source (source px of the scene's crop). Injected: it reads timelines and runs OCR. */
export type ResolveFocus = (scene: AppClipScene | TerminalScene, focus: Focus[]) => Promise<ResolvedFocus[]>;

/** `<cut.out>/<scene id>/<focus id>` -> what `studio fix` decided for it. */
export type CameraOverrides = Record<string, { zoom?: number }>;

export interface Layout {
	/** where the headline block may sit (output px) */
	headline: Rect;
	/** where the camera's picture is shown */
	viewport: Rect;
	/** where the burned captions go (the band above the platform's bottom UI) */
	captions: Rect;
}

/**
 * The frame budget per aspect, inside each profile's safe area (profiles.ts). A headline band holds a title AND a subtitle at
 * the profile's minimum font (`minTextPx / 0.8 * frameH / displayHeight`: 80 px on 9:16, 60 px on the feed formats), so it is
 * at least 2 x 1.1 x font + a gap tall:
 *   9:16  safe y 269..1440: headline 280..476, viewport 490..1240, captions 1262..1416
 *   4:5   safe y 68..1215:  headline 80..236, viewport 250..950, captions 970..1190
 *   1:1   safe y 54..972:   headline 60..216, viewport 226..800, captions 818..950
 * The viewport spans the full width: the app window is wider than tall and the camera is what narrows it.
 */
export function layoutFor(aspect: AspectId): Layout {
	switch (aspect) {
		case "9:16":
			return { headline: { x: 65, y: 275, w: 864, h: 205 }, viewport: { x: 0, y: 506, w: 1080, h: 734 }, captions: { x: 65, y: 1262, w: 864, h: 154 } };
		case "4:5":
			return { headline: { x: 54, y: 62, w: 972, h: 168 }, viewport: { x: 0, y: 250, w: 1080, h: 700 }, captions: { x: 54, y: 970, w: 972, h: 220 } };
		case "1:1":
			return { headline: { x: 54, y: 54, w: 972, h: 168 }, viewport: { x: 0, y: 236, w: 1080, h: 564 }, captions: { x: 54, y: 818, w: 972, h: 132 } };
		case "16:9":
			return { headline: { x: 0, y: 0, w: 1920, h: 0 }, viewport: { x: 0, y: 0, w: 1920, h: 1080 }, captions: { x: 0, y: 0, w: 1920, h: 0 } };
	}
}

/** The platform's safe rect on the aspect's frame (output px): the camera frames focuses inside it. */
export function safeRectFor(aspect: AspectId, profileId: string): Rect | undefined {
	const safe = profileFor(profileId).safe;
	if (!safe) return undefined;
	const a = ASPECTS[aspect];
	const x = Math.round(a.w * safe.left);
	const y = Math.round(a.h * safe.top);
	return { x, y, w: a.w - x - Math.round(a.w * safe.right), h: a.h - y - Math.round(a.h * safe.bottom) };
}

function appFrame(scene: AppClipScene, aspect: AspectId, scale: number): Frame {
	const a = ASPECTS[aspect];
	return { source: { w: scene.crop.w, h: scene.crop.h }, viewport: layoutFor(aspect).viewport, frame: { w: a.w, h: a.h }, scale };
}

/** Source px per CSS px of the recordings: the app records its window at the display's scale (retina = 2). */
export const RECORDING_SCALE = 2;

function planScene(scene: AppClipScene, aspect: AspectId, cutId: string, focuses: ResolvedFocus[], limits: CameraLimits, overrides: CameraOverrides, profileId: string): { camera: Camera; planned: PlannedCamera } {
	const p = profileFor(profileId);
	const frame = appFrame(scene, aspect, RECORDING_SCALE);
	const zoomOverrides: Record<string, number> = {};
	for (const f of focuses) {
		const z = overrides[`${cutId}/${scene.id}/${f.id}`]?.zoom;
		if (z !== undefined) zoomOverrides[f.id] = z;
	}
	const planned = planCamera(frame, { minTextPx: p.minFocusTextPx ?? p.minTextPx, displayHeight: p.displayHeight }, limits, focuses, scene.duration, { zoomOverrides, safe: safeRectFor(aspect, profileId) });
	return { camera: { keys: planned.keys, focuses }, planned };
}

/** Title text laid out for the aspect: wrapped to the safe width, below the top UI. The size is the film's, scaled to fit. */
function titleFor(scene: TitleScene, aspect: AspectId, profileId: string): TitleScene {
	const a = ASPECTS[aspect];
	const safe = profileFor(profileId).safe;
	const l = layoutFor(aspect);
	const maxWidth = Math.floor(a.w * (1 - (safe?.left ?? 0) - (safe?.right ?? 0)) - 1e-6);
	// the 1.0 film's titles are 150 px on 1080 px of height; scale by the frame's short side so they keep their weight
	const k = Math.min(a.w, a.h) / 1080;
	const titleSize = Math.round((scene.text.titleSize * Math.min(1, k * 0.8)) / 2) * 2;
	const y = Math.max(safe ? Math.ceil(safe.top * a.h) + 24 : 0, Math.round(a.h * 0.3 - l.headline.h / 2));
	const mark = scene.mark ? { ...scene.mark, size: Math.round(scene.mark.size * Math.min(1, k * 0.8)), y: Math.max(safe ? Math.ceil(safe.top * a.h) + 24 : 0, Math.round(a.h * 0.16)) } : undefined;
	const centerX = Math.round((a.w * (safe?.left ?? 0) + a.w * (1 - (safe?.right ?? 0))) / 2);
	const text = { ...scene.text, centerX, titleSize, subtitleSize: Math.max(64, Math.round(((scene.text.subtitleSize ?? 48) * 1.5) / 2) * 2), maxWidth, y: mark ? mark.y + mark.size + 40 : y };
	return { ...scene, text, ...(mark ? { mark } : {}) };
}

/**
 * A headline placed in the aspect's headline band: the title and subtitle are scaled DOWN (never up) until the block fits
 * the band's height, wrapped to its width, and `y` is the band's top. Film data says what the headline reads, not where.
 */
function overlayFor(o: NonNullable<AppClipScene["overlay"]>, aspect: AspectId, profileId: string): NonNullable<AppClipScene["overlay"]> {
	const band = layoutFor(aspect).headline;
	const centerX = band.x + band.w / 2;
	const p = profileFor(profileId);
	const floor = Math.ceil((p.minTextPx / GLYPH_BAND) * (ASPECTS[aspect].h / p.displayHeight));
	const sub = o.subtitle ? (o.subtitleSize ?? 48) : 0;
	const gap = o.subtitle ? 22 : 0;
	const k = Math.min(1, band.h / (o.titleSize * 1.1 + gap + sub * 1.1));
	// scaled to the band, never below the legibility floor: the band is budgeted to hold both lines at the floor
	const size = (n: number) => Math.max(floor, Math.round((n * k) / 2) * 2);
	return { ...o, y: band.y, maxWidth: band.w, centerX, titleSize: size(o.titleSize), ...(o.subtitle ? { subtitleSize: size(sub) } : {}) };
}

/**
 * The derived cut. `cut.reframe.from` names the source cut of the film; the result keeps every field of `cut` (voice,
 * captions, out) and fills `scenes` from the source scenes. App scenes get `viewport` + `camera` + a headline overlay
 * taken from their first focus label (the thing the viewer is being shown), terminal scenes the same.
 */
export async function reframeCut(film: Film, cut: Cut, resolve: ResolveFocus, overrides: CameraOverrides = {}, limits: CameraLimits = DEFAULT_LIMITS): Promise<Cut> {
	if (!cut.reframe) throw new Error(`${cut.out} has no reframe: nothing to derive`);
	const from = [...film.cuts, ...(film.sources ?? [])].find((c) => c.out === cut.reframe!.from && !c.reframe);
	if (!from) throw new Error(`${cut.out}: the film has no source cut "${cut.reframe.from}"`);
	const aspect = cut.aspect;
	const profileId = cut.reframe.profile;
	const layout = layoutFor(aspect);
	const scenes: Scene[] = [];
	for (const s of from.scenes) {
		if (s.type === "title") scenes.push(titleFor(s, aspect, profileId));
		else if (s.type === "app") {
			const focuses = s.focus?.length ? await resolve(s, s.focus) : [];
			const { camera } = planScene(s, aspect, cut.out, focuses, limits, overrides, profileId);
			const { box: _box, focus: _focus, push: _push, pan: _pan, ...rest } = s;
			scenes.push({ ...rest, box: { x: layout.viewport.x, y: layout.viewport.y, w: layout.viewport.w }, viewport: layout.viewport, camera, focus: s.focus, bg: s.bg ?? "a", radius: 0, ...(s.overlay ? { overlay: overlayFor(s.overlay, aspect, profileId) } : {}) });
		} else if (s.type === "terminal") {
			scenes.push({ ...s, viewport: layout.viewport, ...(s.overlay ? { overlay: overlayFor(s.overlay, aspect, profileId) } : {}) });
		} else scenes.push(s);
	}
	return { ...cut, scenes };
}
