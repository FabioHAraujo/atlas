/**
 * Deferred UI work that must never share a task with a space switch: one item per timer task, and only after nothing
 * has happened (`bump`: a selection, a gesture) for `quietMs`.
 *
 * WKWebView has no `requestIdleCallback`; the fallback this replaces was a single 50 ms timer per component, so
 * everything deferred in a layer (about eight kit overlays, ~35 nodes under `<body>` each) landed in one task just
 * after the switch: the work moved by 50 ms, the stall did not shrink.
 */
export interface IdleQueueEnv {
	quietMs?: number;
	now?: () => number;
	setTimer?: (f: () => void, ms: number) => number;
	clearTimer?: (id: number) => void;
}

/** Gap between two items of the queue: long enough for a frame to paint between them. */
const GAP_MS = 16;

export function createIdleQueue(env: IdleQueueEnv = {}) {
	const quietMs = env.quietMs ?? 300;
	const now = env.now ?? (() => performance.now());
	const setTimer = env.setTimer ?? ((f, ms) => window.setTimeout(f, ms));
	const clearTimer = env.clearTimer ?? ((id) => window.clearTimeout(id));

	const items: (() => void)[] = [];
	let lastActivity = now();
	let timer: number | null = null;

	function arm(ms: number) {
		if (timer !== null) clearTimer(timer);
		timer = setTimer(tick, ms);
	}

	function tick() {
		timer = null;
		if (!items.length) return;
		const quiet = now() - lastActivity;
		if (quiet < quietMs) return arm(quietMs - quiet);
		const f = items.shift()!;
		try {
			f();
		} catch (e) {
			console.error("[atlas] deferred UI work failed:", e);
		}
		if (items.length) arm(GAP_MS);
	}

	return {
		/** Queue `f`; the returned function cancels it. */
		add(f: () => void): () => void {
			items.push(f);
			if (timer === null) arm(Math.max(0, quietMs - (now() - lastActivity)));
			return () => {
				const i = items.indexOf(f);
				if (i >= 0) items.splice(i, 1);
				if (!items.length && timer !== null) {
					clearTimer(timer);
					timer = null;
				}
			};
		},
		/** Something happened (a selection, a gesture): the quiet wait starts over. */
		bump() {
			lastActivity = now();
		},
	};
}

/** The app's one queue. */
export const idleQueue = createIdleQueue();
