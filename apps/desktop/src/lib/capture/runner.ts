/**
 * Runs a validated capture script: starts the native recorder, executes every step through the app's own stores
 * (via `RunEnv`, never OS input), records exact timings into a timeline and stops the recorder, always.
 *
 * The environment is injected (clock, native calls, app operations) so the sequencing, the timeline and the failure
 * paths are tested without Tauri or a window; `env.ts` builds the real one.
 */

import { easeInOutCubic, rectCenter, type Point } from "./motion.ts";
import type { Script, Step } from "./script.ts";
import { type Rect, type Timeline, TimelineBuilder, shift } from "./timeline.ts";

export interface StartInfo {
	out: string;
	width: number;
	height: number;
	scale: number;
	started_epoch_ms: number;
}
export interface StopInfo {
	out: string;
	width: number;
	height: number;
	frames: number;
	duration_ms: number;
	max_gap_ms: number;
	first_frame_offset_ms: number | null;
	bytes: number;
}

export interface Native {
	start(a: {
		out: string;
		fps: number;
		size: { width: number; height: number };
		cursor: boolean;
	}): Promise<StartInfo>;
	stop(): Promise<StopInfo>;
	shot(a: { out: string; mode: "window" | "snapshot" }): Promise<{ out: string; bytes: number }>;
}

export type CursorSampler = (now: number, x: number, y: number) => void;
export interface CursorOverlay {
	show(): void;
	hide(): void;
	/** Glide the pointer to `p` over `ms`, reporting each position through `sample`. */
	moveTo(p: Point, ms: number, sample: CursorSampler): Promise<void>;
}

export interface AppOps {
	rect(selector: string): Rect | undefined;
	click(a: { selector?: string; text?: string }): Promise<boolean>;
	type(selector: string, text: string, delayMs: number): Promise<void>;
	key(combo: string): void;
	view(v: "agents" | "dashboard" | "worktree"): Promise<void>;
	worktree(project: string, name?: string): Promise<void>;
	tab(kind: "services" | "logs" | "config"): Promise<void>;
	terminal(argv: string[], label?: string): Promise<void>;
	run(command: string, typeDelayMs: number): Promise<void>;
	scroll(selector: string, to: number, ms: number): Promise<void>;
	terminalHas(contains: string): Promise<boolean>;
	textVisible(text: string): boolean;
	cursor: CursorOverlay;
	caption(text: string | null): void;
}

export interface RunEnv {
	now(): number;
	sleep(ms: number): Promise<void>;
	native: Native;
	app: AppOps;
}

export interface RunOpts {
	/** Absolute path of the video. */
	out: string;
	/** Directory for `shot` steps (`<name>.png`). */
	shotsDir: string;
}

export interface RunResult {
	ok: boolean;
	error?: string;
	timeline: Timeline;
}

const POLL_MS = 100;
const DEFAULT_WAIT_MS = 15_000;
const DEFAULT_TYPE_MS = 90;
const DEFAULT_RUN_MS = 45;
const POINTER_MS = 450;

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function runScript(script: Script, opts: RunOpts, env: RunEnv): Promise<RunResult> {
	const { native, app } = env;
	let started: StartInfo;
	try {
		started = await native.start({ out: opts.out, fps: script.fps, size: script.size, cursor: false });
	} catch (e) {
		const tl = new TimelineBuilder({
			size: { ...script.size, scale: 1 },
			fps: script.fps,
			clock: { origin_ms: env.now() },
		});
		return { ok: false, error: errText(e), timeline: tl.finish({ ended_ms: env.now() }) };
	}
	const tl = new TimelineBuilder({
		size: { ...script.size, scale: started.scale },
		fps: script.fps,
		clock: { origin_ms: env.now() },
	});
	let failure: string | undefined;
	if (script.cursor) app.cursor.show();
	try {
		for (const [index, step] of script.steps.entries()) {
			const target = targetSelector(step);
			tl.begin({ index, do: step.do, id: step.id }, env.now(), target ? app.rect(target) : undefined);
			try {
				await exec(step, tl, opts, env, script.cursor);
				tl.end(env.now(), target ? app.rect(target) : undefined);
			} catch (e) {
				failure = `step ${index} (${step.do}): ${errText(e)}`;
				tl.end(env.now(), undefined, errText(e));
				break;
			}
		}
	} finally {
		if (script.cursor) app.cursor.hide();
		app.caption(null);
	}
	const ended = env.now();
	let stopped: StopInfo | undefined;
	try {
		stopped = await native.stop();
	} catch (e) {
		failure ??= `stopping the recorder: ${errText(e)}`;
	}
	let timeline = tl.finish({ ended_ms: ended, error: failure });
	if (stopped) {
		const offset = stopped.first_frame_offset_ms ?? 0;
		timeline = shift(timeline, -offset);
		timeline.video = {
			file: stopped.out,
			width: stopped.width,
			height: stopped.height,
			frames: stopped.frames,
			first_frame_offset_ms: offset,
			max_gap_ms: stopped.max_gap_ms,
		};
	}
	return failure ? { ok: false, error: failure, timeline } : { ok: true, timeline };
}

/** The selector a step acts on, for the rect recorded at its start and end. */
function targetSelector(s: Step): string | undefined {
	switch (s.do) {
		case "click":
		case "type":
		case "scroll":
			return s.selector;
		case "zoom":
		case "focus":
		case "pointer":
			return s.target;
		case "wait":
			return s.selector;
		default:
			return undefined;
	}
}

async function exec(
	s: Step,
	tl: TimelineBuilder,
	opts: RunOpts,
	env: RunEnv,
	cursor: boolean,
): Promise<void> {
	const { app } = env;
	switch (s.do) {
		case "pause":
			await env.sleep(s.ms);
			return;
		case "view":
			await app.view(s.view);
			return;
		case "worktree":
			await app.worktree(s.project, s.name);
			return;
		case "tab":
			await app.tab(s.kind);
			return;
		case "terminal":
			await app.terminal(s.argv, s.label);
			return;
		case "run":
			await app.run(s.command, s.typeDelayMs ?? DEFAULT_RUN_MS);
			return;
		case "type":
			await app.type(s.selector, s.text, s.delayMs ?? DEFAULT_TYPE_MS);
			return;
		case "key":
			app.key(s.combo);
			return;
		case "scroll":
			await app.scroll(s.selector, s.to, s.ms);
			return;
		case "click": {
			if (cursor) {
				const r = s.selector ? app.rect(s.selector) : undefined;
				if (r) await app.cursor.moveTo(rectCenter(r), POINTER_MS, (t, x, y) => tl.cursor(t, x, y));
			}
			if (!(await app.click({ selector: s.selector, text: s.text })))
				throw new Error(`nothing visible to click: ${s.selector ?? JSON.stringify(s.text)}`);
			return;
		}
		case "pointer": {
			const r = app.rect(s.target);
			if (!r) throw new Error(`pointer: no element matches ${s.target}`);
			if (cursor) await app.cursor.moveTo(rectCenter(r), s.ms, (t, x, y) => tl.cursor(t, x, y));
			else await env.sleep(s.ms);
			return;
		}
		case "wait":
			await waitFor(s, env);
			return;
		case "zoom": {
			const r = app.rect(s.target);
			if (!r) throw new Error(`zoom: no element matches ${s.target}`);
			tl.camera({ target: r, scale: s.scale, ms: s.ms });
			await env.sleep(s.ms);
			return;
		}
		case "focus": {
			const r = app.rect(s.target);
			if (!r) throw new Error(`focus: no element matches ${s.target}`);
			// Intent only: the page is untouched. Studio's camera applies the zoom when it cuts the clip.
			tl.focus({ target: r, label: s.label, ms: s.ms, textPx: s.textPx, selector: s.target });
			await env.sleep(s.ms);
			return;
		}
		case "caption":
			tl.caption({ text: s.text, ms: s.ms });
			app.caption(s.text);
			await env.sleep(s.ms);
			app.caption(null);
			return;
		case "mark":
			tl.mark(s.name);
			return;
		case "shot": {
			const file = `${opts.shotsDir}/${s.name}.png`;
			const r = await env.native.shot({ out: file, mode: "window" });
			tl.shot({ name: s.name, file: r.out, width: 0, height: 0 });
			return;
		}
	}
}

async function waitFor(s: Extract<Step, { do: "wait" }>, env: RunEnv): Promise<void> {
	const limit = s.terminal?.timeoutMs ?? s.timeoutMs ?? DEFAULT_WAIT_MS;
	const what =
		s.selector ??
		(s.text !== undefined
			? JSON.stringify(s.text)
			: `terminal output containing ${JSON.stringify(s.terminal?.contains)}`);
	const t0 = env.now();
	for (;;) {
		const hit =
			s.selector !== undefined
				? env.app.rect(s.selector) !== undefined
				: s.text !== undefined
					? env.app.textVisible(s.text)
					: await env.app.terminalHas(s.terminal!.contains);
		if (hit) return;
		if (env.now() - t0 >= limit) throw new Error(`timed out after ${limit} ms waiting for ${what}`);
		await env.sleep(POLL_MS);
	}
}

/** Duration of a glide in `steps` frames at `fps`, used by the overlay; exported for the env's tween loop. */
export const glideSteps = (ms: number, fps = 60) => Math.max(1, Math.round((ms / 1000) * fps));
export { easeInOutCubic };
