/**
 * The timeline a scripted recording leaves behind: exact start/end of every step plus the rects, camera and caption
 * hints and cursor samples Studio needs to cut the clip and to place zooms and captions. Pure (no Tauri, no DOM).
 *
 * All times are milliseconds. The runner records them on its own monotonic clock; `shift` re-bases them onto the
 * video's first frame once the recorder reports when that frame arrived.
 */

export const TIMELINE_VERSION = 1;

export interface Rect {
	x: number;
	y: number;
	width: number;
	height: number;
}
export interface Size {
	width: number;
	height: number;
	/** Pixels per CSS px of the display the window was on (2 on retina). */
	scale: number;
}
export interface StepRecord {
	index: number;
	do: string;
	id?: string;
	start_ms: number;
	end_ms: number;
	ok: boolean;
	error?: string;
	/** CSS px in window content coordinates, when the step targets an element. */
	rect_start?: Rect;
	rect_end?: Rect;
}
export interface CameraHint {
	t: number;
	ms: number;
	scale: number;
	target: Rect;
}
/** A `focus` step: this element must be readable for `ms` from `t`. `selector` lets Studio match it to a Focus. */
export interface FocusHint {
	t: number;
	ms: number;
	/** CSS px in window content coordinates, like `CameraHint.target`. */
	target: Rect;
	label?: string;
	/** CSS px of the smallest text inside `target`. */
	textPx?: number;
	selector: string;
}
export interface CaptionHint {
	t: number;
	ms: number;
	text: string;
}
export interface ShotRecord {
	t: number;
	name: string;
	file: string;
	width: number;
	height: number;
}
export interface MarkRecord {
	t: number;
	name: string;
}
export interface CursorSample {
	t: number;
	x: number;
	y: number;
}
export interface Timeline {
	version: typeof TIMELINE_VERSION;
	size: Size;
	fps: number;
	duration_ms: number;
	steps: StepRecord[];
	camera: CameraHint[];
	/** Absent in timelines recorded before the `focus` step existed; `parseTimeline` fills in []. */
	focus: FocusHint[];
	captions: CaptionHint[];
	shots: ShotRecord[];
	marks: MarkRecord[];
	cursor: CursorSample[];
	/** Filled in by the host: file, pixel size and measured pacing of the video. */
	video?: {
		file: string;
		width: number;
		height: number;
		frames: number;
		first_frame_offset_ms: number;
		max_gap_ms: number;
	};
}

export interface TimelineOpts {
	size: Size;
	fps: number;
	clock: { origin_ms: number };
}

/** Collects what the runner observes. Times passed in are on the runner's clock; stored relative to `origin_ms`. */
export class TimelineBuilder {
	private readonly origin: number;
	private readonly t: Timeline;
	private open: StepRecord | undefined;
	private last = Number.NEGATIVE_INFINITY;
	private lastCursor = Number.NEGATIVE_INFINITY;

	constructor(opts: TimelineOpts) {
		this.origin = opts.clock.origin_ms;
		this.t = {
			version: TIMELINE_VERSION,
			size: opts.size,
			fps: opts.fps,
			duration_ms: 0,
			steps: [],
			camera: [],
			captions: [],
			shots: [],
			marks: [],
			focus: [],
			cursor: [],
		};
	}

	private rel(now: number): number {
		if (now < this.last) throw new Error(`time went backwards (${now} < ${this.last})`);
		this.last = now;
		return now - this.origin;
	}

	begin(step: { index: number; do: string; id?: string }, now: number, rect?: Rect) {
		if (this.open) throw new Error(`step ${this.open.index} is still open`);
		const rec: StepRecord = { index: step.index, do: step.do, start_ms: this.rel(now), end_ms: 0, ok: true };
		if (step.id !== undefined) rec.id = step.id;
		if (rect) rec.rect_start = rect;
		this.open = rec;
	}

	end(now: number, rect?: Rect, error?: string) {
		const s = this.open;
		if (!s) throw new Error("no open step");
		s.end_ms = this.rel(now);
		if (rect) s.rect_end = rect;
		if (error !== undefined) {
			s.ok = false;
			s.error = error;
		}
		this.t.steps.push(s);
		this.open = undefined;
	}

	private start(): number {
		if (!this.open) throw new Error("no open step");
		return this.open.start_ms;
	}

	camera(h: { target: Rect; scale: number; ms: number }) {
		this.t.camera.push({ t: this.start(), ...h });
	}
	focus(h: { target: Rect; label?: string; ms: number; textPx?: number; selector: string }) {
		const hint: FocusHint = { t: this.start(), ms: h.ms, target: h.target, selector: h.selector };
		if (h.label !== undefined) hint.label = h.label;
		if (h.textPx !== undefined) hint.textPx = h.textPx;
		this.t.focus.push(hint);
	}
	caption(h: { text: string; ms: number }) {
		this.t.captions.push({ t: this.start(), ...h });
	}
	shot(s: { name: string; file: string; width: number; height: number }) {
		this.t.shots.push({ t: this.start(), ...s });
	}
	mark(name: string) {
		this.t.marks.push({ t: this.start(), name });
	}
	/** Pointer sample at runner time `now` (strictly increasing, or the track cannot be interpolated). */
	cursor(now: number, x: number, y: number) {
		if (now <= this.lastCursor) throw new Error("cursor samples must be strictly increasing");
		this.lastCursor = now;
		this.t.cursor.push({ t: now - this.origin, x, y });
	}

	/** Close the timeline at runner time `ended_ms`; a step still open is closed there as failed. */
	finish(o: { ended_ms: number; error?: string }): Timeline {
		if (this.open) this.end(o.ended_ms, undefined, o.error ?? "script ended inside this step");
		this.t.duration_ms = o.ended_ms - this.origin;
		return this.t;
	}
}

/** Move every time by `delta` ms (negative = the video's first frame is later than the clock origin). Clamps at 0. */
export function shift(t: Timeline, delta: number): Timeline {
	const m = (v: number) => Math.max(0, v + delta);
	return {
		...t,
		duration_ms: Math.max(0, t.duration_ms + delta),
		steps: t.steps.map((s) => ({ ...s, start_ms: m(s.start_ms), end_ms: m(s.end_ms) })),
		camera: t.camera.map((c) => ({ ...c, t: m(c.t) })),
		focus: t.focus.map((c) => ({ ...c, t: m(c.t) })),
		captions: t.captions.map((c) => ({ ...c, t: m(c.t) })),
		shots: t.shots.map((c) => ({ ...c, t: m(c.t) })),
		marks: t.marks.map((c) => ({ ...c, t: m(c.t) })),
		cursor: t.cursor.map((c) => ({ ...c, t: m(c.t) })),
	};
}

export const cameraTrack = (t: Timeline): CameraHint[] => t.camera;
export const captionTrack = (t: Timeline): CaptionHint[] => t.captions;

export type TimelineParse = { ok: true; timeline: Timeline } | { ok: false; errors: string[] };

const isObj = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Validate a timeline read from disk: version, shape, ordered non-overlapping steps inside the duration. */
export function parseTimeline(v: unknown): TimelineParse {
	const errors: string[] = [];
	if (!isObj(v)) return { ok: false, errors: ["a timeline is a JSON object"] };
	if (v.version !== TIMELINE_VERSION) errors.push(`version must be ${TIMELINE_VERSION}`);
	if (typeof v.duration_ms !== "number" || !(v.duration_ms >= 0))
		errors.push("duration_ms must be a number >= 0");
	for (const k of ["steps", "camera", "captions", "shots", "marks", "cursor"] as const)
		if (!Array.isArray(v[k])) errors.push(`${k} must be a list`);
	if (v.focus !== undefined && !Array.isArray(v.focus)) errors.push("focus must be a list");
	if (errors.length) return { ok: false, errors };
	// Additive field: a timeline recorded before `focus` existed has none, which is the same as no hints.
	const t = { ...v, focus: v.focus ?? [] } as unknown as Timeline;
	t.focus.forEach((h, i) => {
		if (!isObj(h)) return void errors.push(`focus[${i}] must be an object`);
		if (typeof h.t !== "number" || !(h.t >= 0)) errors.push(`focus[${i}].t must be a number >= 0`);
		if (typeof h.ms !== "number" || !(h.ms >= 0)) errors.push(`focus[${i}].ms must be a number >= 0`);
		if (typeof h.selector !== "string" || h.selector === "")
			errors.push(`focus[${i}].selector must be a non-empty string`);
		if (h.label !== undefined && typeof h.label !== "string")
			errors.push(`focus[${i}].label must be a string`);
		if (h.textPx !== undefined && typeof h.textPx !== "number")
			errors.push(`focus[${i}].textPx must be a number`);
		const r = h.target;
		if (!isObj(r) || !(["x", "y", "width", "height"] as const).every((k) => Number.isFinite(r[k])))
			errors.push(`focus[${i}].target must be a rect { x, y, width, height }`);
	});
	let prevEnd = 0;
	t.steps.forEach((s, i) => {
		if (!(s.end_ms >= s.start_ms)) errors.push(`steps[${i}] ends before it starts`);
		if (s.start_ms < prevEnd) errors.push(`steps[${i}] overlaps the previous step`);
		if (s.end_ms > t.duration_ms)
			errors.push(`steps[${i}] ends after the timeline (${s.end_ms} > ${t.duration_ms})`);
		prevEnd = s.end_ms;
	});
	return errors.length ? { ok: false, errors } : { ok: true, timeline: t };
}
