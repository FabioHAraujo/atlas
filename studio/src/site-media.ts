// What the site's loops and screenshots are made of: one table that the recipe (recipes/site-media.ts: what to record)
// and the encoder (`bun studio loops`: how each file is cut and encoded) both read, so a loop's length, its source
// capture and its poster cannot drift apart. Sizes and budgets are the ones of site/public/media/README.md.

/** A silent 16:10 loop of the real app, published as loop-<name>.mp4/.webm/-poster.jpg. */
export interface LoopSpec {
	name: string;
	/** Recipe capture id (recipes/site-media.ts) that records it. `tui` is cut from the vhs take instead. */
	capture: string;
	/** Seconds into the capture where the loop starts (the app's first moments are settling, not content). */
	from: number;
	/** Length of the loop in seconds. */
	seconds: number;
}

/** A still of the real app, published as shot-<name>.jpg (2000 px wide). */
export interface ShotSpec {
	name: string;
	capture: string;
	/** Name of the recipe `shot` step whose window PNG it is. */
	shot: string;
}

export const LOOPS: LoopSpec[] = [
	{ name: "workspace", capture: "workspace", from: 0.5, seconds: 10 },
	{ name: "panel", capture: "panel", from: 0.5, seconds: 9 },
	{ name: "logs", capture: "logs", from: 0.5, seconds: 12 },
	{ name: "terminal", capture: "terminal", from: 0.5, seconds: 10 },
	{ name: "agents", capture: "agents", from: 0.5, seconds: 14 },
	{ name: "mcp", capture: "mcp", from: 0.5, seconds: 14 },
];

export const SHOTS: ShotSpec[] = [
	{ name: "workspace", capture: "workspace", shot: "workspace" },
	{ name: "panel", capture: "panel", shot: "panel" },
	{ name: "logs", capture: "logs", shot: "logs" },
	{ name: "terminal", capture: "terminal", shot: "terminal" },
	{ name: "agents", capture: "agents", shot: "agents" },
];

/** Encode budget of one loop file, bytes (README: < 600 KB). */
export const LOOP_MAX_BYTES = 600_000;
