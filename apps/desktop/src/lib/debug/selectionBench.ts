/**
 * Selection benchmark: what one space/worktree selection costs the main thread, measured in the real app.
 *
 * Page side of `scripts/selection-bench.ts` (which seeds a scratch registry of ~13 projects and runs this through
 * `atlas desktop debug eval`). One *selection* is the commit a swipe or a click ends in: `shell.select` →
 * `store.selected` + `ws.select`. Per selection we record
 *
 *  - `flushMs`   the synchronous Svelte flush right after the write (mount/teardown + effects),
 *  - `paintMs`   write → second rAF (≈ first frame the new state could be on screen),
 *  - `stallMs`   the longest main-thread gap seen by a MessageChannel ping-pong (WKWebView reports no `longtask`),
 *  - `nodes`     DOM nodes added + removed (MutationObserver on `document.body`, every kind of record),
 *  - `records`   MutationObserver records.
 *
 * The statistics and the budget are pure (`summarize`, `check`) so they are unit-tested without a webview.
 */

export interface Sample {
	flushMs: number;
	paintMs: number;
	stallMs: number;
	nodes: number;
	records: number;
}

export interface Stat {
	p50: number;
	p95: number;
	max: number;
}
export type Summary = Record<keyof Sample, Stat> & { n: number };

/** The budget a selection must stay inside. `nodes` is what may visibly change: one space's chrome, not a layer. */
export interface Budget {
	stallP95Ms: number;
	flushP95Ms: number;
	nodesP95: number;
}

/** Selection ≤ 8 ms of main thread (p95), and no layer-sized DOM churn (a layer is ~350 nodes). */
export const BUDGET: Budget = { stallP95Ms: 8, flushP95Ms: 8, nodesP95: 120 };

const round = (n: number) => Math.round(n * 10) / 10;

/** Nearest-rank percentile of an unsorted list (0 for an empty one: a bench that measured nothing must not pass). */
export function pct(xs: number[], p: number): number {
	if (xs.length === 0) return 0;
	const s = [...xs].sort((a, b) => a - b);
	return s[Math.min(s.length - 1, Math.max(0, Math.ceil(s.length * p) - 1))]!;
}

export function summarize(samples: Sample[]): Summary {
	const keys = ["flushMs", "paintMs", "stallMs", "nodes", "records"] as const;
	const out = { n: samples.length } as Summary;
	for (const k of keys) {
		const xs = samples.map((s) => s[k]);
		out[k] = { p50: round(pct(xs, 0.5)), p95: round(pct(xs, 0.95)), max: round(Math.max(0, ...xs)) };
	}
	return out;
}

/** Violations of `budget`, one readable line each; empty = within budget. No samples is itself a violation. */
export function check(sum: Summary, budget: Budget = BUDGET): string[] {
	if (sum.n === 0) return ["no selections were measured"];
	const v: string[] = [];
	if (sum.stallMs.p95 > budget.stallP95Ms)
		v.push(`main-thread stall p95 ${sum.stallMs.p95} ms > ${budget.stallP95Ms} ms`);
	if (sum.flushMs.p95 > budget.flushP95Ms)
		v.push(`flush p95 ${sum.flushMs.p95} ms > ${budget.flushP95Ms} ms`);
	if (sum.nodes.p95 > budget.nodesP95) v.push(`DOM nodes touched p95 ${sum.nodes.p95} > ${budget.nodesP95}`);
	return v;
}

interface Shell {
	spaceIds: string[];
	select(worktreeId: string): void;
	landing(spaceId: string): string;
}
export interface BenchEnv {
	shell: Shell;
	/** Pause so each selection starts from a settled page. */
	settleMs?: number;
	/** Selections (A→B→A counts two). */
	rounds?: number;
	/** Longest a selection's follow-up work may keep its sample open. */
	maxQuietMs?: number;
	/** Space indices to alternate between; adjacent by default (the case a swipe makes). */
	between?: [number, number];
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const frames = (n: number) =>
	new Promise<void>((r) => {
		const step = (k: number) => (k <= 0 ? r() : requestAnimationFrame(() => step(k - 1)));
		step(n);
	});

export interface QuietEnv {
	now(): number;
	sleep(ms: number): Promise<void>;
	/** `now()` value of the latest DOM mutation or stall. */
	lastEvent(): number;
	quietMs: number;
	maxMs: number;
	stepMs: number;
}

/**
 * Wait until nothing has mutated the DOM or stalled the thread for `quietMs`, at most `maxMs`; returns how long it
 * waited. A space switch schedules follow-up work well after the flush (deferred overlays, the native snapshot
 * warm-up): a selection owns everything it causes, so the sample stays open until the page is quiet again.
 */
export async function waitQuiet(env: QuietEnv): Promise<number> {
	const t0 = env.now();
	for (;;) {
		await env.sleep(env.stepMs);
		const waited = env.now() - t0;
		if (env.now() - Math.max(env.lastEvent(), t0) >= env.quietMs || waited >= env.maxMs) return waited;
	}
}

/** Run the A→B→A selection loop in the live page and return one sample per selection. */
export async function runSelectionBench(
	env: BenchEnv,
): Promise<{ samples: Sample[]; layers: number; dom: number }> {
	const { shell } = env;
	const [ia, ib] = env.between ?? [0, 1];
	const a = shell.spaceIds[ia];
	const b = shell.spaceIds[ib];
	if (!a || !b || a === b) throw new Error(`selection bench needs two spaces, have ${shell.spaceIds.length}`);
	const pick = (id: string) => shell.select(shell.landing(id));

	let records = 0;
	let nodes = 0;
	let lastEvent = performance.now();
	const mo = new MutationObserver((ms) => {
		lastEvent = performance.now();
		for (const m of ms) {
			records++;
			nodes += m.addedNodes.length + m.removedNodes.length;
		}
	});
	mo.observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true });

	// A gap between two pongs is a stretch of main thread nobody else could use.
	let last = performance.now();
	let worst = 0;
	let on = true;
	const ch = new MessageChannel();
	ch.port1.onmessage = () => {
		const now = performance.now();
		if (now - last > 4) lastEvent = now; // a stall is activity too
		worst = Math.max(worst, now - last);
		last = now;
		if (on) ch.port2.postMessage(0);
	};

	pick(a);
	await sleep(env.settleMs ?? 600);
	const samples: Sample[] = [];
	try {
		for (let i = 0; i < (env.rounds ?? 40); i++) {
			await sleep(env.settleMs ?? 100);
			mo.takeRecords();
			records = nodes = 0;
			worst = 0;
			last = performance.now();
			ch.port2.postMessage(0);
			await sleep(20); // let the detector start ticking before the write
			worst = 0;
			const t0 = performance.now();
			pick(i % 2 === 0 ? b : a);
			await Promise.resolve();
			const flushMs = performance.now() - t0;
			await frames(2);
			const paintMs = performance.now() - t0;
			// late effects, deferred overlays and the native warm-up belong to the selection that caused them
			await waitQuiet({
				now: () => performance.now(),
				sleep,
				lastEvent: () => lastEvent,
				quietMs: 250,
				maxMs: env.maxQuietMs ?? 4000,
				stepMs: 50,
			});
			mo.takeRecords().forEach((m) => {
				records++;
				nodes += m.addedNodes.length + m.removedNodes.length;
			});
			samples.push({ flushMs, paintMs, stallMs: worst, nodes, records });
		}
	} finally {
		on = false;
		mo.disconnect();
	}
	return {
		samples,
		layers: document.querySelectorAll(".space-layer").length,
		dom: document.querySelectorAll("*").length,
	};
}
