/**
 * Gesture bench, page side (`scripts/gesture-bench.ts` drives it through `atlas desktop debug eval`).
 *
 * `createProbe()` records, while a trace is replayed into the engine: every animation frame (gap), main-thread
 * stalls (a MessageChannel ping that comes back late = the main thread was busy), forced layouts, and the
 * pager layers' transforms per frame. `assess()` is pure: it turns one run plus the trace's expectation into
 * named violations, so what "fluid" means is in one tested place.
 */
import type { Expect } from "#lib/shell/trace.ts";

export interface Run {
	trace: string;
	expect: Expect;
	/** Space (or tab) selected before and after, and every selection change in between. */
	start: string;
	end: string;
	/** The pages in order (wrapping): what `start` and `end` are positions in. */
	order: string[];
	committed: string[];
	frames: { t: number; gap: number }[];
	stalls: { t: number; ms: number }[];
	reflows: number;
	/** Lift → layers at rest, ms. */
	settleMs: number;
	/** Origin layer translation per frame, in page widths (0 = at rest, -1 = one page left). */
	samples: { t: number; x: number }[];
	/** First engine event that claims → first frame with a moved layer, ms. */
	firstMoveMs: number;
	native: { parked: number; restored: number };
	consistent: boolean;
	/** What the engine decided, in order: (generation, dir). Held to the expectation apart from the app's landing. */
	engineCommits?: [number, number][];
	/** The trace reverses direction on purpose: monotonic checks apply per leg. */
	reversal?: boolean;
}

export interface Violation {
	rule: string;
	detail: string;
}

/** The numbers the bench holds the app to; `hz` is the display's refresh. */
export const BUDGET = {
	/** A frame may take this long during tracking/settle before it counts as dropped. */
	gap: (hz: number) => (1000 / hz) * 1.2 + 3,
	/** The webview stalls longer than this are a long task for our purposes. */
	stallMs: 20,
	settle: [250, 350] as const,
	/** Overshoot past the target, in page widths. */
	overshoot: 0.01,
	/** Input → first moved frame: one frame of the display. */
	firstMove: (hz: number) => 1000 / hz + 4,
	reflows: 0,
};

/** The host's jitter while the page does nothing: what a timing rule cannot be blamed on the app below. */
export interface Floor {
	gapP95: number;
	worstStall: number;
	frames: number;
}

export function noiseFloor(idle: { frames: { gap: number }[]; stalls: { ms: number }[] }): Floor {
	const g = idle.frames.map((f) => f.gap).sort((a, b) => a - b);
	return {
		gapP95: g.length ? (g[Math.min(g.length - 1, Math.floor(g.length * 0.95))] ?? 0) : 0,
		worstStall: Math.max(0, ...idle.stalls.map((s) => s.ms)),
		frames: g.length,
	};
}

export function assess(r: Run, o: { hz: number; floor?: Floor }): Violation[] {
	const v: Violation[] = [];
	const add = (rule: string, detail: string) => v.push({ rule, detail });
	const wantEnd = r.expect.steps;
	// Net page steps between where it began and where it ended, going the short way round the (wrapping) order.
	const n = r.order.length;
	const raw = r.order.indexOf(r.end) - r.order.indexOf(r.start);
	const net = n > 2 && Math.abs(raw) > n / 2 ? raw - Math.sign(raw) * n : raw;
	if (net !== r.expect.steps)
		add(
			"wrong-target",
			`expected ${r.expect.steps >= 0 ? "+" : ""}${r.expect.steps} page(s) from ${r.start}, ended on ${r.end} (${net >= 0 ? "+" : ""}${net})`,
		);
	// One decision per gesture, and a gesture moves at most one page.
	const gestures = r.expect.gestures ?? (r.expect.steps === 0 ? 0 : 1);
	if (r.committed.length > Math.max(gestures, 1) && r.expect.steps !== 0)
		add(
			"double-commit",
			`${r.committed.length} selection changes for ${gestures} gesture(s): ${r.committed.join(" → ")}`,
		);
	if (r.expect.steps === 0 && r.committed.length > gestures)
		add(
			"double-commit",
			`${r.committed.length} selection changes for a gesture that must not switch: ${r.committed.join(" → ")}`,
		);
	if (r.engineCommits) {
		const seqs = r.engineCommits.map(([q]) => q);
		const engineNet = r.engineCommits.reduce((a, [, d]) => a + d, 0);
		if (new Set(seqs).size !== seqs.length)
			add("engine-decision", `a generation decided twice: ${JSON.stringify(r.engineCommits)}`);
		else if (r.engineCommits.some(([, d]) => Math.abs(d) > 1))
			add("engine-decision", `a gesture moved more than one page: ${JSON.stringify(r.engineCommits)}`);
		else if (engineNet !== wantEnd)
			add(
				"engine-decision",
				`engine net ${engineNet >= 0 ? "+" : ""}${engineNet}, expected ${wantEnd >= 0 ? "+" : ""}${wantEnd}: ${JSON.stringify(r.engineCommits)}`,
			);
	}
	if (r.expect.untouched && r.samples.some((s) => Math.abs(s.x) > 1e-6))
		add("moved-when-untouched", "a layer moved for a gesture that must not swipe");
	// Timing is held to the budget, or to 1.5x the host's own idle jitter when that is worse: a loaded machine
	// cannot be fluid, and blaming the gesture for it would hide the real regressions.
	const gapLimit = Math.max(BUDGET.gap(o.hz), (o.floor?.gapP95 ?? 0) * 1.5, (o.floor?.worstStall ?? 0) * 1.5);
	const stallLimit = Math.max(BUDGET.stallMs, (o.floor?.worstStall ?? 0) * 1.5);
	const worst = Math.max(0, ...r.frames.map((f) => f.gap));
	if (worst > gapLimit) add("frame-gap", `worst frame ${worst.toFixed(1)} ms > ${gapLimit.toFixed(1)} ms`);
	for (const s of r.stalls)
		if (s.ms > stallLimit) add("stall", `main thread busy ${s.ms.toFixed(0)} ms at ${s.t.toFixed(0)} ms`);
	if (r.reflows > BUDGET.reflows) add("layout-thrash", `${r.reflows} forced layouts during the gesture`);
	if (r.samples.length && wantEnd !== 0) {
		if (r.settleMs < BUDGET.settle[0] || r.settleMs > BUDGET.settle[1])
			add("settle-time", `${r.settleMs.toFixed(0)} ms, budget ${BUDGET.settle[0]}-${BUDGET.settle[1]}`);
		// positions accumulate across gestures (see frameSamples): a +2 run ends at -2
		const target = -wantEnd;
		const past = Math.max(...r.samples.map((s) => (target - s.x) * Math.sign(wantEnd)));
		if (past > BUDGET.overshoot) add("overshoot", `${past.toFixed(3)} pages past the target`);
	}
	if (!r.reversal && r.samples.length > 2 && wantEnd !== 0) {
		const dir = -Math.sign(wantEnd);
		for (let i = 1; i < r.samples.length; i++) {
			if ((r.samples[i]!.x - r.samples[i - 1]!.x) * dir < -0.02) {
				add(
					"non-monotonic",
					`moved back at ${r.samples[i]!.t.toFixed(0)} ms: ${r.samples[i - 1]!.x.toFixed(3)} → ${r.samples[i]!.x.toFixed(3)}`,
				);
				break;
			}
		}
	}
	if (wantEnd !== 0 && r.firstMoveMs > Math.max(BUDGET.firstMove(o.hz), (o.floor?.gapP95 ?? 0) * 1.5))
		add(
			"first-move",
			`${r.firstMoveMs.toFixed(1)} ms to the first moved frame, budget ${BUDGET.firstMove(o.hz).toFixed(1)}`,
		);
	if (r.native.parked !== r.native.restored)
		add("native-not-restored", `${r.native.parked} natives parked, ${r.native.restored} restored`);
	if (!r.consistent) add("inconsistent-end-state", "selection, tab group and URL disagree after the gesture");
	return v;
}

/** What the page needs to expose for a run: the live stores and the pager layers. */
export interface ProbeEnv {
	/** Selected page id (space or tab). */
	selected(): string;
}

/**
 * Starts recording; `stop()` returns the raw measurements of the run. Frames come from `requestAnimationFrame`,
 * stalls from a `MessageChannel` ping-pong (a pong later than 4 ms after the ping means the main thread was
 * busy), reflows by counting the layout-forcing reads while recording.
 */
export function createProbe(env: ProbeEnv) {
	const frames: { t: number; gap: number }[] = [];
	const stalls: { t: number; ms: number }[] = [];
	const committed: string[] = [];
	// A read is a forced layout only if the DOM changed since the last one: watch every mutation, and ask the
	// observer for the records still queued at the moment of each read (taking them marks them as accounted for).
	const dirty = new MutationObserver(() => {});
	dirty.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
	const counter = new ReadCounter(() => dirty.takeRecords().length);
	let on = false;
	let raf = 0;
	let t0 = 0;
	let last = 0;
	let lastSel = env.selected();
	const restore: (() => void)[] = [];
	/** Where a read was asked for: the first app frame of the stack, so a count can be traced to its caller. */
	const site = () => {
		const f = (new Error().stack ?? "")
			.split("\n")
			.slice(2)
			.find((l) => !l.includes("gestureProbe"));
		return (f ?? "?").trim().replace(/^.*\//, "").slice(0, 90);
	};

	for (const [proto, names] of [
		[Element.prototype, ["getBoundingClientRect", "getClientRects", "scrollIntoView"]],
		[HTMLElement.prototype, ["offsetWidth", "offsetHeight", "offsetTop", "offsetLeft", "innerText"]],
	] as const) {
		for (const name of names) {
			const d = Object.getOwnPropertyDescriptor(proto, name);
			if (!d) continue;
			if (typeof d.value === "function") {
				const orig = d.value;
				Object.defineProperty(proto, name, {
					...d,
					value: function (this: unknown, ...a: unknown[]) {
						if (on) counter.read(site());
						return orig.apply(this, a);
					},
				});
				restore.push(() => Object.defineProperty(proto, name, d));
			} else if (d.get) {
				const get = d.get;
				Object.defineProperty(proto, name, {
					...d,
					get(this: unknown) {
						if (on) counter.read(site());
						return get.call(this);
					},
				});
				restore.push(() => Object.defineProperty(proto, name, d));
			}
		}
	}

	const ch = new MessageChannel();
	let pinged = 0;
	ch.port1.onmessage = () => {
		const ms = performance.now() - pinged;
		if (on && ms > 4) stalls.push({ t: Math.round(performance.now() - t0), ms: Math.round(ms) });
		if (on) setTimeout(ping, 0);
	};
	function ping() {
		pinged = performance.now();
		ch.port2.postMessage(0);
	}

	function tick(t: number) {
		if (!on) return;
		frames.push({ t: Math.round(t - t0), gap: Math.round((t - last) * 10) / 10 });
		last = t;
		const sel = env.selected();
		if (sel !== lastSel) committed.push(sel);
		lastSel = sel;
		raf = requestAnimationFrame(tick);
	}

	return {
		start() {
			on = true;
			t0 = last = performance.now();
			lastSel = env.selected();
			raf = requestAnimationFrame(tick);
			ping();
		},
		stop() {
			on = false;
			cancelAnimationFrame(raf);
			for (const r of restore) r();
			dirty.disconnect();
			return {
				frames: frames.slice(1),
				stalls,
				committed,
				reflows: counter.forced,
				reads: counter.reads,
				reflowSites: counter.sites,
			};
		},
	};
}

/** Rules whose outcome depends on how busy the machine was; everything else is deterministic. */
const NOISY = new Set(["frame-gap", "stall", "first-move"]);

/** Only noisy rules fired: worth another attempt (a loaded host shows up as stalls and long frames). */
export function isTimingOnly(v: Violation[]): boolean {
	return v.length > 0 && v.every((x) => NOISY.has(x.rule));
}

/** The attempt with the fewest violations (a clean one wins at once). */
export function bestRun<T extends { v: Violation[] }>(attempts: T[]): T {
	return attempts.reduce((best, a) => (a.v.length < best.v.length ? a : best));
}

/**
 * Counts layout reads and which of them were FORCED layouts: a read answered from a clean layout is free, one that
 * follows a DOM change makes the engine recalculate style and layout synchronously. `pending()` returns how many
 * DOM mutations are queued since the last read (a `MutationObserver.takeRecords()` length).
 */
export class ReadCounter {
	reads = 0;
	forced = 0;
	sites: Record<string, number> = {};
	#pending: () => number;
	constructor(pending: () => number) {
		this.#pending = pending;
	}
	read(site: string) {
		this.reads++;
		if (this.#pending() > 0) {
			this.forced++;
			this.sites[site] = (this.sites[site] ?? 0) + 1;
		}
	}
}
