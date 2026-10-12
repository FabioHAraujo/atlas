/**
 * Stateful controller of the Logs tab: owns the ring, the incrementally maintained `View`, the
 * time-sliced rebuild/search pumps and the counters the toolbar shows. The component feeds it the
 * filter and ring and reads `rev`/`total`/... to re-render; everything else is plain, non-reactive
 * engine state (`rev` is the one signal that says "the view changed").
 */

import type { LogLine, Ring } from "./model.ts";
import { Search } from "./search.ts";
import { Refilter, View, type Filter } from "./view.ts";
import { cancelIdle, idle } from "#lib/utils/timing.ts";

export class LogsEngine {
	ring: Ring<LogLine>;
	view = new View();
	refilter: Refilter | null = null;
	search: Search | null = null;
	/** Absolute ring index up to which lines have reached the view. */
	consumed: number;

	rev = $state(0);
	total = $state(0);
	errors = $state(0);
	warns = $state(0);
	matchCount = $state(0);
	searching = $state(false);
	/** Error lines per service, for the chips. */
	counts = $state<Record<string, number>>({});
	/** Current match / jump target (view row), or -1. */
	cur = $state(-1);
	/** A ⏎ pressed while the scan had no match yet: jump when the first one arrives. */
	pendingJump = false;

	/** Called when the first match arrives for a pending ⏎. */
	onFirstMatch: () => void = () => {};

	#searchTimer = 0;
	#refilterTimer = 0;
	#countedUpTo: number;

	constructor(ring: Ring<LogLine>) {
		this.ring = ring;
		this.consumed = ring.base + ring.length;
		this.#countedUpTo = ring.base;
	}

	get filtering() {
		return !!this.refilter || this.searching;
	}

	lineAt(r: number): LogLine | undefined {
		return this.ring.items[this.view.idx[r] - this.ring.base];
	}

	destroy() {
		if (this.#refilterTimer) cancelIdle(this.#refilterTimer);
		if (this.#searchTimer) cancelIdle(this.#searchTimer);
	}

	#publish() {
		this.total = this.view.length;
		this.errors = this.view.errors;
		this.warns = this.view.warns;
		this.rev++;
	}

	/** Per-service error counts for the chips, over the whole ring but only for new lines. */
	recount(reset: boolean) {
		const { ring } = this;
		if (reset) {
			this.counts = {};
			this.#countedUpTo = ring.base;
		}
		const next = { ...this.counts };
		for (let i = Math.max(this.#countedUpTo, ring.base) - ring.base; i < ring.length; i++) {
			const l = ring.items[i];
			if (l.mark === undefined && l.level === "error") next[l.name] = (next[l.name] ?? 0) + 1;
		}
		this.#countedUpTo = ring.base + ring.length;
		this.counts = next;
	}

	/** Start (or restart) a chunked rebuild of the view for `filter` (with the clock applied by the caller). */
	rebuild(filter: Filter, matcher: RegExp | null) {
		if (this.#refilterTimer) cancelIdle(this.#refilterTimer);
		if (this.#searchTimer) cancelIdle(this.#searchTimer);
		this.#searchTimer = 0;
		// The old search indexes the old view: drop it until the rebuild finishes.
		this.search = null;
		this.matchCount = 0;
		this.searching = false;
		this.cur = -1;
		this.view = new View();
		this.refilter = new Refilter(filter, this.ring);
		this.consumed = this.ring.base + this.ring.length;
		this.#pumpRefilter(matcher);
	}

	#pumpRefilter(matcher: RegExp | null) {
		this.#refilterTimer = 0;
		const r = this.refilter;
		if (!r) return;
		const done = r.step(8);
		this.view = r.view;
		this.#publish();
		if (done) {
			this.refilter = null;
			this.consumed = this.ring.base + this.ring.length;
			this.#restartSearch(matcher);
		} else this.#refilterTimer = idle(() => this.#pumpRefilter(matcher));
	}

	#restartSearch(matcher: RegExp | null) {
		if (this.#searchTimer) cancelIdle(this.#searchTimer);
		this.#searchTimer = 0;
		this.search = matcher ? new Search(matcher, this.view, this.ring) : null;
		this.matchCount = 0;
		this.cur = -1;
		if (this.search) {
			this.searching = true;
			this.#pumpSearch();
		} else this.searching = false;
	}

	#pumpSearch() {
		this.#searchTimer = 0;
		const s = this.search;
		if (!s) return;
		const done = s.scan(5);
		this.matchCount = s.rows.length;
		this.searching = !done;
		if (!done) this.#searchTimer = idle(() => this.#pumpSearch());
		else if (this.cur < 0 && s.rows.length && this.pendingJump) {
			this.pendingJump = false;
			this.onFirstMatch();
		}
	}

	/** Drop what a sliding window aged out; a straggler behind a newer line rebuilds. */
	slide(cutoff: number, rebuild: () => void) {
		if (this.refilter) return;
		const dropped = this.view.slide(cutoff);
		if (dropped === "rebuild") return rebuild();
		if (!dropped) return;
		this.#shift(dropped);
		this.matchCount = this.search?.rows.length ?? 0;
		this.#publish();
	}

	#shift(dropped: number) {
		if (this.search) this.search.shift(dropped);
		if (this.cur >= 0) this.cur = Math.max(-1, this.cur - dropped);
	}

	/**
	 * New lines → append to the view and refresh the counters; a replaced ring (resync) → `rebuild`.
	 * `filterNow` is the filter with the clock of this very moment.
	 */
	ingest(fresh: Ring<LogLine>, filterNow: () => Filter, rebuild: () => void) {
		if (fresh !== this.ring) {
			this.ring = fresh;
			this.recount(true);
			rebuild();
			return;
		}
		if (this.refilter) return; // the running rebuild reads to the ring's end
		const end = this.ring.base + this.ring.length;
		if (end === this.consumed) return;
		// The ring may have trimmed since `consumed`: drop view entries it no longer holds.
		const dropped = this.view.trim(this.ring.base);
		if (dropped) this.#shift(dropped);
		const had = this.view.length;
		this.view.add(filterNow(), this.ring, this.consumed);
		this.consumed = end;
		this.recount(false);
		this.#publish();
		if (this.search && this.view.length > had && !this.#searchTimer) {
			this.searching = true;
			this.#pumpSearch();
		}
		this.matchCount = this.search?.rows.length ?? 0;
	}

	/** Lines of the filtered view (cap = last `max`), for copy and "Copy for AI". */
	viewLines(max = Infinity): LogLine[] {
		const out: LogLine[] = [];
		for (let r = Math.max(0, this.view.length - max); r < this.view.length; r++) {
			const l = this.lineAt(r);
			if (l) out.push(l);
		}
		return out;
	}
}
