import type { Camera, Focus } from "../camera/types.ts";

// The contracts of the studio. A film is plain data (studio/films/<id>/film.ts); scene builders turn each scene into
// a HyperFrames sub-composition; the compiler (src/compile.ts) assembles one project per film and aspect ratio.

export type AspectId = "16:9" | "9:16" | "4:5" | "1:1";

export interface Aspect {
	id: AspectId;
	w: number;
	h: number;
	/** file-name suffix: "" for 16:9, "-vertical", "-portrait", "-square" */
	suffix: string;
}

export const ASPECTS: Record<AspectId, Aspect> = {
	"16:9": { id: "16:9", w: 1920, h: 1080, suffix: "" },
	"9:16": { id: "9:16", w: 1080, h: 1920, suffix: "-vertical" },
	"4:5": { id: "4:5", w: 1080, h: 1350, suffix: "-portrait" },
	"1:1": { id: "1:1", w: 1080, h: 1080, suffix: "-square" },
};

/** Crop of a source recording, in source pixels. */
export interface Crop {
	x: number;
	y: number;
	w: number;
	h: number;
}

/** Placement on the frame, in frame pixels of the cut's aspect. `x`/`y` may be "center". `h` is derived from the source when omitted. */
export interface Box {
	x: number | "center";
	y: number | "center";
	w: number;
	h?: number;
}

/** A cobalt background still: cache key `bg:<id>`. */
export type BgId = "a" | "b" | "c" | "v" | (string & {});

/**
 * How a scene enters. `dip`: fade up from the field (the film's cut: 0.25 s in, 0.25 s out). `crossfade`: the scene
 * overlaps the previous one by `duration` and fades in over it. `cut`: no fade.
 */
export interface Transition {
	type: "dip" | "crossfade" | "cut";
	duration: number;
}

export interface SceneBase {
	/** unique in the film; becomes the composition id and DOM prefix */
	id: string;
	/** seconds on screen (for `crossfade` entries the overlap is part of this) */
	duration: number;
	bg?: BgId;
	/** background slow zoom: scale added per frame at 30 fps (the film uses 0.0004–0.0005); 0 = still */
	zoom?: number;
	transitionIn?: Transition;
	/** fade-out at the end, seconds (default: the film's dip, 0.25; 0 disables) */
	fadeOut?: number;
}

/** Atlas mark (assets/logo/logo.svg) placed on the frame. */
export interface Mark {
	size: number;
	y: number;
	/** seconds after scene start when the mark fades in, and how long the fade takes */
	delay?: number;
	fade?: number;
}

/** Title block: large headline, optional subtitle and mono url. */
export interface TitleText {
	title: string;
	subtitle?: string;
	url?: string;
	/** px from the top of the frame */
	y: number;
	titleSize: number;
	subtitleSize?: number;
	/** wrap the block to this width (px) and center it; omit for a single centered line (the 1.0 film's layout) */
	maxWidth?: number;
	/** horizontal center of the block, px from the left of the frame (default: the frame's center). Social cuts center on the safe rect. */
	centerX?: number;
	/** fade-in of the whole text block: start and duration in seconds (omit: visible from the first frame) */
	delay?: number;
	fade?: number;
}

export interface TitleScene extends SceneBase {
	type: "title";
	text: TitleText;
	mark?: Mark;
}

export interface CodeScene extends SceneBase {
	type: "code";
	/** headline above the card */
	heading: { text: string; y: number; size: number };
	/** file name in the window chrome */
	file: string;
	lang: string;
	code: string;
	/** px from the top of the frame to the card, and its width */
	y: number;
	width: number;
	fontSize: number;
	/** fade-in of the whole card: start and duration in seconds */
	delay?: number;
	fade?: number;
	/** type the code character by character (seeked, deterministic); omit for a static card */
	typing?: { startAt: number; cps: number };
}

export interface CursorKey {
	/** seconds into the clip */
	t: number;
	/** position inside the clip box, 0..1 */
	x: number;
	y: number;
	click?: boolean;
}

/** A rectangle, pixels (source pixels or output pixels: the field that holds it says which). */
export interface Rect {
	x: number;
	y: number;
	w: number;
	h: number;
}

export interface AppClipScene extends SceneBase {
	type: "app";
	/** asset key of the recording: `rec:<scene>` (see `bun studio capture app`) */
	clip: string;
	/** seek into the recording, seconds */
	from: number;
	crop: Crop;
	box: Box;
	/** slow push-in of the clip over the scene (non-timed wrapper, so it is seek-safe) */
	push?: { from: number; to: number; originX?: number; originY?: number };
	/** drift of the clip over the scene, px */
	pan?: { x: number; y: number };
	/** ring + click pulse over the recording (which captures no cursor); keys in clip seconds */
	cursor?: CursorKey[];
	/** headline drawn over the clip (the vertical cut) */
	overlay?: TitleText;
	radius?: number;
	/** what the viewer must read, in order; the social renditions derive the virtual camera from it (`reframe`) */
	focus?: Focus[];
	/** the camera the planner derived for this rendition (set by `reframe`, never by hand) */
	camera?: Camera;
	/** where the camera's picture sits on the frame (set by `reframe`; `box` is used when absent) */
	viewport?: Rect;
}

export interface TerminalScene extends SceneBase {
	type: "terminal";
	/** asset key of the vhs take: `take:<name>` */
	take: string;
	/** dense cut of the take: source segments in seconds, joined back to back */
	segments: Array<[number, number]>;
	speed?: number;
	/** width of the terminal on the frame (px); the height follows the take's aspect */
	width: number;
	/** vertical placement; x is always centered */
	y?: number | "center";
	overlay?: TitleText;
	focus?: Focus[];
	camera?: Camera;
	viewport?: Rect;
}

export type Scene = TitleScene | CodeScene | AppClipScene | TerminalScene;

/** Overlays sit above the scenes at an absolute time. */
export type Overlay =
	| { type: "lower-third"; at: number; duration: number; title: string; subtitle?: string }
	| { type: "chapter"; at: number; duration: number; index: number; title: string };

export interface Chapter {
	/** seconds: the beat where the voice starts the topic (what the player scrubs to) */
	t: number;
	title: string;
}

export interface NarrationLine {
	id: string;
	text: string;
	/** seconds in the film when the line starts */
	at: number;
}

export interface VoiceSpec {
	/** ElevenLabs voice id */
	id: string;
	/** delivery tag prepended to every line (Eleven v4 audio tag) */
	tag: string;
	stability: number;
	similarity: number;
	/** pinned model; `bun studio voice --models` lists the account's and flags a newer one */
	model: string;
	/** the voice is compressed, then normalised to this before mixing */
	lufs: number;
	lines: NarrationLine[];
}

export interface MusicSpec {
	/** asset key (`music:bed`) */
	bed: string;
	/** bed level before ducking, LUFS */
	bedLufs: number;
	fadeIn: number;
	fadeOut: number;
	/** sidechain compressor driven by the voice; times in ms */
	duck: { threshold: number; ratio: number; attack: number; release: number };
	/** provenance and licence, copied into the publish report and site/public/media/README.md */
	source: string;
	license: string;
}

export interface Captions {
	/** WebVTT file next to the video */
	vtt: boolean;
	/** burn the captions into the picture (social cuts autoplay muted) */
	burned: boolean;
	/** how burned captions are styled and placed (src/captions/styles.ts); default: the cut's platform preset */
	style?: "reels" | "tiktok" | "shorts" | "feed";
}

export interface Cut {
	aspect: AspectId;
	/** output stem; default `film` + the aspect suffix */
	out: string;
	scenes: Scene[];
	overlays?: Overlay[];
	voice?: VoiceSpec;
	chapters?: Chapter[];
	captions: Captions;
	/** second of the poster frame (default: the middle) */
	poster?: number;
	/**
	 * A rendition DERIVED from a source cut of the same film (`from` is that cut's `out`, in `Film.sources`): its scenes are the source cut's scenes, re-laid-out for
	 * this aspect, with the virtual camera planned from each scene's `focus` list (src/camera/reframe.ts). `scenes` is
	 * ignored (leave it empty): there is one set of film data, many renditions.
	 */
	reframe?: { from: string; profile: string };
}

export interface Film {
	id: string;
	title: string;
	fps: number;
	/** x264 CRF of the delivery encode (higher = smaller file; 26 reproduces the 1.0 film's size) */
	crf: number;
	music?: MusicSpec;
	/** integrated loudness target and tolerance, LUFS; the render fails outside it */
	loudness: { target: number; tolerance: number };
	cuts: Cut[];
	/**
	 * Source cuts that exist only to be reframed: scenes with `focus` lists, never rendered, linted or published
	 * themselves. One set of film data; the `renditions` below are derived from it.
	 */
	sources?: Cut[];
	/**
	 * Cuts DERIVED from `sources` (`Cut.reframe`): 9:16, 4:5 and 1:1 social renditions with the virtual camera planned
	 * from the focuses. `render`, `lint`, `fix` and `still` address them by `--cut <out>`; `publish` and `check` use
	 * `cuts` only, so a social rendition is never published by accident.
	 */
	renditions?: Cut[];
}
