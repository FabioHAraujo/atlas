/**
 * The filtered view: the filter predicate, the search-box compiler, the incrementally maintained
 * `View` (index list of passing lines) and the time-sliced `Refilter` rebuild.
 *
 * Cost model (n = buffered lines, k = new lines in a batch): append is O(k) (only the new lines
 * meet the filter); a filter change re-scans in time-sliced chunks so typing never blocks.
 */

import { NO_WINDOW, inWindow, type TimeWindow } from "./range.ts";
import { RANK, type Level, type LogLine, type Ring } from "./model.ts";

export interface Filter {
	/** Service name; `null` = all. */
	only: string | null;
	minLevel: Level;
	/** In filter mode, lines that do not match `matcher` are hidden. */
	matcher: RegExp | null;
	hideNonMatching: boolean;
	/** Time bounds (`NO_WINDOW` = unbounded). */
	win: TimeWindow;
	/** Epoch ms below which a sliding window drops lines; set when the filter is built. */
	cutoff?: number;
}

export const NO_FILTER: Filter = {
	only: null,
	minLevel: "info",
	matcher: null,
	hideNonMatching: false,
	win: NO_WINDOW,
};

/** Whether `l` (at absolute ring index `abs`) passes the filter. Marks respect the service and the time window. */
export function accepts(f: Filter, l: LogLine, abs: number): boolean {
	if (f.win !== NO_WINDOW && !inWindow(f.win, l.ts, abs, f.cutoff ?? 0)) return false;
	if (l.mark !== undefined) return !f.only || l.name === f.only;
	if (f.only && l.name !== f.only) return false;
	if (RANK[l.level] < RANK[f.minLevel]) return false;
	if (f.matcher && f.hideNonMatching) {
		f.matcher.lastIndex = 0;
		return f.matcher.test(l.line);
	}
	return true;
}

/**
 * Compile the search box into a global, case-aware RegExp. Returns `null` for an
 * empty query and `"bad"` for an invalid regex.
 */
export function compileQuery(query: string, regex: boolean, matchCase: boolean): RegExp | null | "bad" {
	if (!query) return null;
	try {
		const src = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		const re = new RegExp(src, matchCase ? "g" : "gi");
		// A pattern that matches the empty string (`a*`) would highlight nothing and loop.
		return re.test("") ? "bad" : re;
	} catch {
		return "bad";
	}
}

/**
 * Index list of the lines passing a filter, as *absolute* line numbers (`ring.base + i`).
 * Appends are incremental; `trim` forgets entries the ring dropped.
 */
export class View {
	/** Absolute indexes (ring.base + position) of the visible lines, ascending. */
	idx: number[] = [];
	/** Level rank of each entry (parallel to `idx`), so trimming never needs the dropped lines. */
	#lv: number[] = [];
	/** Timestamp of each entry (parallel to `idx`): a sliding window drops by it without the ring. */
	#ts: number[] = [];
	/** Monotonic queue of `[abs, ts]` with strictly increasing ts: the front is the oldest timestamp. */
	#minTs: [number, number][] = [];
	#minHead = 0;
	/** Per-level counts of the visible lines. */
	errors = 0;
	warns = 0;

	add(f: Filter, ring: Ring<LogLine>, from: number) {
		const { items, base } = ring;
		for (let i = from - base < 0 ? 0 : from - base; i < items.length; i++) {
			if (accepts(f, items[i], base + i)) this.push(items[i], base + i);
		}
	}

	push(l: LogLine, abs: number) {
		const rank = l.mark === undefined ? RANK[l.level] : 0;
		this.idx.push(abs);
		this.#lv.push(rank);
		this.#ts.push(l.ts);
		const q = this.#minTs;
		while (q.length > this.#minHead && q[q.length - 1][1] >= l.ts) q.pop();
		q.push([abs, l.ts]);
		if (rank === 2) this.errors++;
		else if (rank === 1) this.warns++;
	}

	/** Drop entries below `base` (trimmed by the ring); returns how many went. */
	trim(base: number): number {
		let n = 0;
		while (n < this.idx.length && this.idx[n] < base) n++;
		return this.#dropFront(n);
	}

	/**
	 * Move a sliding window's cutoff: drop the entries older than `cutoff` (epoch ms).
	 * Lines arrive in time order, so they are almost always a prefix and this costs O(dropped).
	 * A straggler hiding behind a newer entry (a replayed backlog, a clock step) cannot be
	 * popped from the front: the oldest-timestamp tracker reports it in O(1) and `slide`
	 * answers `"rebuild"`, so the caller re-filters once instead of keeping a stale row.
	 * Returns how many leading rows went, or `"rebuild"`.
	 */
	slide(cutoff: number): number | "rebuild" {
		let n = 0;
		while (n < this.#ts.length && this.#ts[n] < cutoff) n++;
		const dropped = this.#dropFront(n);
		const q = this.#minTs;
		return this.#minHead < q.length && q[this.#minHead][1] < cutoff ? "rebuild" : dropped;
	}

	#dropFront(n: number): number {
		if (!n) return 0;
		for (let i = 0; i < n; i++) {
			if (this.#lv[i] === 2) this.errors--;
			else if (this.#lv[i] === 1) this.warns--;
		}
		const next = this.idx[n]; // first survivor (undefined when everything went)
		this.idx = this.idx.slice(n);
		this.#lv = this.#lv.slice(n);
		this.#ts = this.#ts.slice(n);
		// The tracker forgets entries that left the front (they are all below `next`).
		const q = this.#minTs;
		while (this.#minHead < q.length && (next === undefined || q[this.#minHead][0] < next)) this.#minHead++;
		if (this.#minHead > 64 && this.#minHead * 2 > q.length) {
			this.#minTs = q.slice(this.#minHead);
			this.#minHead = 0;
		}
		return n;
	}

	get length() {
		return this.idx.length;
	}
}

/**
 * Time-sliced rebuild of a `View` after a filter change. `step()` scans for at most
 * `budgetMs` and reports whether it is done; the caller schedules it between frames.
 * Lines that arrive meanwhile are picked up because the scan always runs to the
 * ring's current end.
 */
export class Refilter {
	view = new View();
	#at: number;
	constructor(
		readonly filter: Filter,
		readonly ring: Ring<LogLine>,
	) {
		this.#at = ring.base;
	}

	get done() {
		return this.#at >= this.ring.base + this.ring.length;
	}

	step(budgetMs = 6, chunk = 2048): boolean {
		const start = performance.now();
		while (!this.done) {
			const { items, base } = this.ring;
			// The ring may have trimmed while we were yielding: forget what it dropped.
			if (this.#at < base) this.#at = base;
			this.view.trim(base);
			const end = Math.min(items.length, this.#at - base + chunk);
			for (let i = this.#at - base; i < end; i++) {
				if (accepts(this.filter, items[i], base + i)) this.view.push(items[i], base + i);
			}
			this.#at = base + end;
			if (performance.now() - start > budgetMs) break;
		}
		return this.done;
	}
}
