/**
 * Keeps the native stage's snapshot cache warm (`page_layers.rs`). The stage slides cached snapshots of the
 * outgoing and incoming page natively; JS owns the DOM, so JS produces them: a page that is parked out of view
 * has to be brought into view for one frame to be snapshotted. That must never be visible, so it runs behind a
 * **cover** (the native side snapshots what is on screen and raises it over the pager) and only while idle.
 *
 *   warm(ids)         snapshot these pages, in order, inside one cover; the page on screen needs no cover
 *   warmIfStale(ids)  the subset not snapshotted since they last changed (`dirty`)
 *   abort()           a gesture began: stop after the step in flight, park what is shown, lift the cover
 *   resume()          the gesture ended: warm what was queued
 *
 * Pure orchestration over injected effects, so the ordering (cover → show → frame → snapshot → park → uncover,
 * always balanced) is tested without a DOM or a native side.
 */

export interface StageEffects {
	ids(): string[];
	active(): string | null;
	/** Bring page `id` into view / put it back where it parks. */
	show(id: string): void;
	park(id: string): void;
	/** Resolves after the page has been laid out and painted with the change. */
	nextFrame(): Promise<void>;
	/** Native: snapshot what is on screen and raise it over the pager. False: could not cover. */
	cover(): Promise<boolean>;
	uncover(): Promise<void>;
	/** Native: snapshot the pager rect as page `id`. */
	snapshot(id: string): Promise<boolean>;
	/** Tell native the page order and the pager rect. */
	pages(): Promise<void>;
	/** Run `f` when the app is idle. */
	idle(f: () => Promise<void> | void): void;
	gestureActive(): boolean;
	/** ms since the last selection, gesture or content mutation: warm-ups wait for the app to be quiet. */
	quietMs(): number;
}

/** How long the app must be input-quiet before a snapshot (`takeSnapshot` runs on the main thread). */
export const QUIET_MS = 300;

export function createStageSync(fx: StageEffects) {
	/** Pages whose snapshot is current. */
	const fresh = new Set<string>();
	let queue: string[] = [];
	let running = false;
	let aborted = false;

	/** One page. A snapshot that cannot be taken just leaves the page stale; it never leaves it shown. */
	async function step(id: string) {
		const shown = id !== fx.active();
		if (shown) fx.show(id);
		try {
			if (shown) await fx.nextFrame();
			if (!aborted && (await fx.snapshot(id))) fresh.add(id);
		} catch {
			// no snapshot: the page stays stale and the slide shows its last picture (or the background)
		} finally {
			if (shown) fx.park(id);
		}
	}

	/** The cover stays up across the tasks of one run and is lifted after the last page (or an abort). */
	let covered = false;

	async function lift() {
		if (!covered) return;
		covered = false;
		await fx.uncover();
	}

	/**
	 * One page per task: a snapshot costs main-thread time (measured 40 ms for a few), so between two pages the
	 * thread goes back to the app, and nothing starts until it has been quiet for `QUIET_MS`.
	 */
	async function drain() {
		if (running) return;
		if (queue.length === 0) return void (await lift());
		if (aborted || fx.gestureActive()) {
			await lift();
			return;
		}
		if (fx.quietMs() < QUIET_MS) return void fx.idle(drain); // too soon after activity: look again later
		running = true;
		aborted = false;
		try {
			const id = queue[0]!;
			if (id !== fx.active() && !covered) covered = await fx.cover();
			if (id !== fx.active() && !covered) {
				queue = [];
				return;
			}
			queue.shift();
			await step(id);
		} finally {
			running = false;
		}
		if (queue.length && !aborted && !fx.gestureActive()) fx.idle(drain);
		else await lift();
	}

	return {
		warm(ids: string[]) {
			for (const id of ids) if (!queue.includes(id)) queue.push(id);
			fx.idle(drain);
		},
		warmIfStale(ids: string[]) {
			this.warm(ids.filter((id) => !fresh.has(id)));
		},
		dirty(id: string) {
			fresh.delete(id);
		},
		abort() {
			aborted = true;
			// A run in flight lifts the cover itself when its step returns; idle ones lift it now.
			if (!running) void lift();
		},
		resume() {
			fx.idle(drain);
		},
		isFresh: (id: string) => fresh.has(id),
	};
}
