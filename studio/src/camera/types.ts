// The virtual camera: the contract between film data, the planner (plan.ts), the compositor (scenes/app.ts), the
// sidecar the render writes (`<cut>.camera.json`) and the lint (src/lint/camera.ts). Pure data, no I/O.
//
// Coordinates. A camera looks at a SOURCE (an app recording cropped to its window, or a terminal take). Everything
// about the source is in SOURCE PIXELS of that crop (x right, y down, origin = top-left of the crop). Everything about
// the output is in OUTPUT PIXELS of the cut's frame (1080x1920, 1080x1080, 1080x1350, 1920x1080). The VIEWPORT is the
// rectangle of the output frame where the camera's picture is shown; the rest of the frame is the field, the headline
// and the captions.

import type { Rect } from "../lib/types.ts";

/** How the camera gets from the previous key to this one. `cut` jumps (no motion); `hold` stays where it was. */
export type CameraEase = "cut" | "hold" | "ease" | "spring";

/**
 * One camera pose at scene-local time `t`. `x`,`y` is the point of the source in the CENTER of the viewport; `zoom` is
 * the scale relative to "the whole source fits the viewport width" (1 = the whole window, 2 = half of its width).
 */
export interface CameraKey {
	t: number;
	x: number;
	y: number;
	zoom: number;
	/** how the camera ARRIVES at this key from the previous one (the first key's ease is ignored) */
	ease: CameraEase;
	/** seconds the camera takes to arrive; the planner derives it from the speed limits, 0 for `cut`/`hold` */
	move: number;
	/** the focus this key frames, when it frames one (for diagnostics and fixes) */
	focus?: string;
}

/** A thing the viewer must be able to read in a shot: where it is in the source, when, for how long. */
export interface Focus {
	/** stable id inside the scene: diagnostics and camera.json overrides refer to it */
	id: string;
	/** seconds into the SCENE when the text must be readable */
	at: number;
	/** seconds it stays readable (the camera holds; default 1.2) */
	hold?: number;
	/** capture selector of an element the recording's timeline has a rect for (the recipe's `focus` step), or ... */
	selector?: string;
	/** ... a text on screen, located by OCR on the source frame at `at` (for footage recorded without focus steps) */
	text?: string;
	/** a rect in source pixels, when neither of the two applies */
	rect?: Rect;
	/** what the viewer is meant to see; shown as the shot's callout when the cut asks for it */
	label?: string;
	/**
	 * Smallest text in the focus, in CSS px of the app (what the designer set; the planner converts it to source
	 * pixels with the recording's scale). Default `DEFAULT_TEXT_CSS_PX`.
	 */
	textPx?: number;
}

/** Motion-design limits of the camera; a viewer must be able to follow and read. */
export interface CameraLimits {
	/** max speed of the viewport center, OUTPUT px/s (a pan faster than ~1/2 frame width per second is a whip) */
	maxPanPxPerSec: number;
	/** max zoom change, in e-folds per second (ln(z2/z1)/s): 0.9 = a 2.5x push in about a second */
	maxZoomPerSec: number;
	/** seconds the camera must be still before the focus' text is shown/read (the settle) */
	settle: number;
	/** farther than this (output px, center to center) the camera CUTS instead of panning */
	cutDistancePx: number;
	/** a move the speed limits would stretch past this many seconds is a CUT: the viewer must not wait for the camera */
	maxMoveSeconds: number;
	/** the shortest move; ease/spring never animate shorter than this */
	minMove: number;
}

/** Spring easing as Apple/Motion parameterise it: `duration` to settle, `bounce` 0 (critical) ... 1. */
export interface SpringSpec {
	bounce: number;
}

/** What a scene's camera is: the planner's output (keys) and the intent that produced it (focuses). */
export interface Camera {
	keys: CameraKey[];
	/** the focuses the keys were derived from, with their resolved source rects */
	focuses: ResolvedFocus[];
}

/** A focus whose rect is known, in source pixels. */
export interface ResolvedFocus extends Focus {
	rect: Rect;
	/** how the rect was found: the timeline's rect of the selector, OCR of the text, or given */
	via: "timeline" | "ocr" | "rect";
}

/** The shot's geometry the planner needs. */
export interface Frame {
	/** size of the source crop, source px */
	source: { w: number; h: number };
	/** output px of the viewport on the cut's frame */
	viewport: Rect;
	/** the cut's frame, output px */
	frame: { w: number; h: number };
	/** source px per CSS px of the app (2 on the retina recordings) */
	scale: number;
}

/** Output-px legibility the target asks for: shown height of the OCR glyph band at `displayHeight`. */
export interface Legibility {
	minTextPx: number;
	displayHeight: number;
}

export const DEFAULT_TEXT_CSS_PX = 12;
/** The glyph band OCR reports for a line (ascender to descender) is about this many times the CSS font size. */
export const GLYPH_BAND = 0.8;

export const DEFAULT_LIMITS: CameraLimits = {
	maxPanPxPerSec: 700,
	maxZoomPerSec: 0.9,
	settle: 0.35,
	cutDistancePx: 1400,
	maxMoveSeconds: 1.6,
	minMove: 0.4,
};

// ── the sidecar the render writes next to the video, and the lint reads ──────────────────────────────────────────────

/** `<cut>.camera.json`: what the camera did in each shot, in the output's own pixels. */
export interface CameraSidecar {
	version: 1;
	film: string;
	cut: string;
	aspect: string;
	frame: { w: number; h: number };
	fps: number;
	shots: ShotPlan[];
	/** burned-in captions as laid out (see src/captions) */
	captions?: CaptionCue[];
}

export interface ShotPlan {
	id: string;
	/** start and end in the cut, seconds */
	start: number;
	end: number;
	/** where the camera's picture is shown on the frame, output px (absent: the shot has no camera) */
	viewport?: Rect;
	source?: { w: number; h: number };
	/** CSS px -> source px of the recording */
	scale?: number;
	keys: CameraKey[];
	/** per focus: when it must be readable (cut seconds), its rect in output px at that time, the text size asked for */
	focuses: FocusPlan[];
	limits: CameraLimits;
}

export interface FocusPlan {
	id: string;
	label?: string;
	/** cut seconds: readable from `from` to `to` (the camera is still within it) */
	from: number;
	to: number;
	/** the focus rect in OUTPUT px while the camera holds on it */
	rect: Rect;
	/** the zoom at the hold, and the zoom the legibility rule needs (the planner caps it at the source's resolution) */
	zoom: number;
	neededZoom: number;
	/** estimated glyph band of the smallest text, in px at the display height, at that zoom */
	shownTextPx: number;
	/** CSS px of the smallest text the focus asked for */
	textPx: number;
}

export interface CaptionCue {
	/** cut seconds */
	start: number;
	end: number;
	text: string;
	/** lines after wrapping */
	lines: string[];
	/** output px rect of the caption block */
	rect: Rect;
	/** the style's font size in output px */
	fontPx: number;
}
