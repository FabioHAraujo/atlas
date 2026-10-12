/**
 * Search over a filtered view (lazy, chunked scan with binary-search navigation) and the
 * row-jump helpers (next error/warn, row at a timestamp).
 */

import { RANK, type Level, type LogLine, type Ring } from "./model.ts";
import type { View } from "./view.ts";

/** All non-empty matches of `re` in `text`. */
export function matchesIn(re: RegExp, text: string): [number, number][] {
	const out: [number, number][] = [];
	re.lastIndex = 0;
	for (let m = re.exec(text); m; m = re.exec(text)) {
		if (!m[0]) {
			re.lastIndex++;
			continue;
		}
		out.push([m.index, m.index + m[0].length]);
	}
	return out;
}

/**
 * Rows of `view` whose text matches `re`, scanned incrementally. `scan()` advances a
 * cursor in chunks; `rows` are ascending view positions, so next/prev are binary
 * searches. `count` is the number of matching *rows* (not occurrences).
 */
export class Search {
	rows: number[] = [];
	#at = 0;
	constructor(
		readonly re: RegExp,
		readonly view: View,
		readonly ring: Ring<LogLine>,
	) {}

	get done() {
		return this.#at >= this.view.length;
	}

	/** Forget rows below `drop` view entries (the view trimmed its head) and shift the rest. */
	shift(drop: number) {
		if (!drop) return;
		let n = 0;
		while (n < this.rows.length && this.rows[n] < drop) n++;
		this.rows = this.rows.slice(n).map((r) => r - drop);
		this.#at = Math.max(0, this.#at - drop);
	}

	scan(budgetMs = 4, chunk = 4096): boolean {
		const start = performance.now();
		const { idx } = this.view;
		const { items, base } = this.ring;
		while (this.#at < idx.length) {
			const end = Math.min(idx.length, this.#at + chunk);
			for (let r = this.#at; r < end; r++) {
				const l = items[idx[r] - base];
				if (!l || l.mark !== undefined) continue;
				this.re.lastIndex = 0;
				if (this.re.test(l.line)) this.rows.push(r);
			}
			this.#at = end;
			if (performance.now() - start > budgetMs) break;
		}
		return this.done;
	}

	/** First matching row strictly after `row` (wraps), or -1. */
	next(row: number): number {
		const { rows } = this;
		if (!rows.length) return -1;
		let lo = 0;
		let hi = rows.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (rows[mid] <= row) lo = mid + 1;
			else hi = mid;
		}
		return rows[lo === rows.length ? 0 : lo];
	}

	/** Last matching row strictly before `row` (wraps), or -1. */
	prev(row: number): number {
		const { rows } = this;
		if (!rows.length) return -1;
		let lo = 0;
		let hi = rows.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (rows[mid] < row) lo = mid + 1;
			else hi = mid;
		}
		return rows[lo === 0 ? rows.length - 1 : lo - 1];
	}

	/** 1-based ordinal of `row` among the matches (0 when it is not one). */
	ordinal(row: number): number {
		const { rows } = this;
		let lo = 0;
		let hi = rows.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (rows[mid] < row) lo = mid + 1;
			else hi = mid;
		}
		return rows[lo] === row ? lo + 1 : 0;
	}
}

/** Nearest view row after/before `row` holding a line of at least `min` level (wraps), or -1. */
export function jumpLevel(view: View, ring: Ring<LogLine>, row: number, dir: 1 | -1, min: Level): number {
	const n = view.length;
	if (!n) return -1;
	const { items, base } = ring;
	for (let k = 1; k <= n; k++) {
		const r = (((row + dir * k) % n) + n) % n;
		const l = items[view.idx[r] - base];
		if (l && l.mark === undefined && RANK[l.level] >= RANK[min]) return r;
	}
	return -1;
}

/** First view row whose line is at or after `ts` (timestamps ascend with the ring); the last row when all are older, -1 when empty. */
export function rowAtTime(view: View, ring: Ring<LogLine>, ts: number): number {
	const n = view.length;
	if (!n) return -1;
	let lo = 0;
	let hi = n;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		const l = ring.items[view.idx[mid] - ring.base];
		if (l && l.ts < ts) lo = mid + 1;
		else hi = mid;
	}
	return Math.min(lo, n - 1);
}
