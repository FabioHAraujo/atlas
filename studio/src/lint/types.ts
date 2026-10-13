// The "video LSP" contract: every check reports Diagnostics, shaped like LSP's (severity, code, message, range) plus a
// pixel rect or time range and a machine-readable suggested fix, so an agent or an editor can act on them without
// parsing prose. `bun studio lint --json` prints `LintReport`.

export type Severity = "error" | "warning" | "info";

/** A region of the frame in pixels of the linted file. */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** A time range in seconds of the linted file. */
export interface TimeRange {
	start: number;
	end: number;
}

/**
 * A fix an agent can apply. `action` is a stable verb; `params` carry the numbers (e.g. the headroom to add in
 * pixels at the file's own resolution); `film` is the film.ts-level hint when the file comes from a film.
 */
export interface Fix {
	action: "add-headroom" | "reframe" | "move-out-of-safe-zone" | "enlarge-text" | "raise-contrast" | "normalize-loudness" | "limit-peaks" | "re-encode" | "trim" | "reduce-flashing" | "remove-black" | "remove-freeze" | "change-resolution" | "lower-bitrate" | "set-keyframe-interval";
	description: string;
	params?: Record<string, number | string>;
}

export interface Diagnostic {
	severity: Severity;
	/** stable code, `<area>/<name>`: frame/edge-clipped, text/too-small, audio/loudness, … */
	code: string;
	message: string;
	/** where in the picture */
	rect?: Rect;
	/** when in the video */
	range?: TimeRange;
	fix?: Fix;
	/** measured value and the limit it was compared with, for agents that want to reason about margins */
	measured?: number;
	limit?: number;
}

/** What the file is for. Limits and safe areas come from the profile, never hard-coded in a check. */
export interface Profile {
	id: string;
	description: string;
	/** accepted aspect ratio (w/h) with tolerance; undefined = any */
	aspect?: { ratio: number; tolerance: number };
	/** minimum pixels of the short side; below this the picture is soft on that surface */
	minShortSide?: number;
	maxDuration?: number;
	minDuration?: number;
	/** integrated loudness target (LUFS), tolerance in LU, and true-peak ceiling (dBTP); undefined = no audio rules */
	loudness?: { target: number; tolerance: number; truePeak: number };
	/** fraction of the frame reserved by the platform UI: text and the subject must stay out of it */
	safe?: { top: number; bottom: number; left: number; right: number };
	/** smallest legible glyph height (cap/x-height box) in px when the frame is shown at `displayHeight` px tall */
	minTextPx: number;
	displayHeight: number;
	/** codecs accepted for the video stream */
	codecs?: string[];
	/** max video bitrate in kb/s, max keyframe interval in seconds */
	maxVideoKbps?: number;
	maxKeyframeSec?: number;
	/** the file is a recording of the real app: its UI typography is the app's, so text rules are not applied */
	captured?: boolean;
	/** the required margin (fraction of the frame's short side) between a detected subject and each frame edge */
	headroom: number;
}

export interface LintTarget {
	file: string;
	kind: "image" | "video";
	profile: string;
	width: number;
	height: number;
	duration?: number;
}

export interface LintReport {
	version: 1;
	/** relative to cwd when possible */
	target: LintTarget;
	diagnostics: Diagnostic[];
	/** checks that could not run (missing tool, no audio, …): never silent */
	skipped: Array<{ check: string; reason: string }>;
	summary: { errors: number; warnings: number; infos: number };
}
