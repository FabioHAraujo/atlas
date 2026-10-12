/**
 * Virtualization and follow-the-tail state of the Logs viewport: row geometry (fixed or wrapped),
 * the visible window, scrolling to a row and the "new lines below" counter. The engine supplies
 * the view; the component binds `el`, `height` and `width`.
 */

import { untrack } from "svelte";
import type { LogsEngine } from "./engine.svelte.ts";
import { wrappedRows } from "./text.ts";
import type { LogLine } from "./model.ts";

export const ROW = 18;
const OVERSCAN = 12;

export class LogsViewport {
	private readonly engine!: LogsEngine;
	/** A single service is shown, so the service column is hidden. */
	private readonly hasOnly!: () => boolean;
	el: HTMLDivElement | undefined = $state();
	scrollTop = $state(0);
	height = $state(400);
	width = $state(800);
	/** Advance width of one monospace column, measured from the probe span. */
	charW = $state(7.2);
	follow = $state(true);
	unseen = $state(0);
	showTime = $state(true);
	wrap = $state(false);
	/** Set while a programmatic jump to the bottom is in flight, so it is not read as the user scrolling. */
	#pinned = false;
	#lastScroll = 0;
	#lastTotal = 0;
	/** Offsets of each row's top in wrap mode (`offsets[r]`, length = rows + 1); fixed mode is `r * ROW`. */
	#offsets: number[] = [0];
	#offsetsFor = { rev: -1, cols: 0, wrap: false };

	cols = $derived(
		Math.max(
			20,
			Math.floor((this.width - 32 - (this.showTime ? 70 : 0) - (this.hasOnly() ? 0 : 102)) / this.charW),
		),
	);

	/** Total content height; recomputes the wrap offsets when anything that changes row heights changed. */
	contentH = $derived.by(() => {
		void this.engine.rev;
		void this.cols;
		void this.wrap;
		void this.showTime;
		return this.#layout();
	});
	first = $derived(Math.max(0, this.rowAt(this.scrollTop) - OVERSCAN));
	last = $derived(Math.min(this.engine.total, this.rowAt(this.scrollTop + this.height) + 1 + OVERSCAN));
	rows = $derived.by(() => {
		void this.engine.rev;
		const out: { r: number; l: LogLine }[] = [];
		for (let r = this.first; r < this.last; r++) {
			const l = this.engine.lineAt(r);
			if (l) out.push({ r, l });
		}
		return out;
	});

	constructor(engine: LogsEngine, hasOnly: () => boolean) {
		this.engine = engine;
		this.hasOnly = hasOnly;
	}

	#layout(): number {
		const { view } = this.engine;
		if (!this.wrap) return view.length * ROW;
		const key = { rev: this.engine.rev, cols: this.cols, wrap: this.wrap };
		const f = this.#offsetsFor;
		if (f.rev !== key.rev || f.cols !== key.cols || f.wrap !== key.wrap) {
			const n = view.length;
			const o = new Array<number>(n + 1);
			let y = 0;
			for (let r = 0; r < n; r++) {
				o[r] = y;
				const l = this.engine.lineAt(r);
				y += ROW * (l ? wrappedRows(l.line.length, this.cols) : 1);
			}
			o[n] = y;
			this.#offsets = o;
			this.#offsetsFor = key;
		}
		return this.#offsets[view.length];
	}

	/** First row whose bottom is below `y`. */
	rowAt(y: number): number {
		if (!this.wrap) return Math.floor(y / ROW);
		let lo = 0;
		let hi = this.engine.view.length;
		while (lo < hi) {
			const mid = (lo + hi) >> 1;
			if (this.#offsets[mid + 1] <= y) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	}

	topOf(r: number): number {
		return this.wrap ? this.#offsets[r] : r * ROW;
	}

	/** Stay on the newest line while following; otherwise count what arrived below. Call from an effect on `rev`/`contentH`. */
	followTail() {
		const { total } = this.engine;
		const added = Math.max(0, total - this.#lastTotal);
		this.#lastTotal = total;
		if (this.follow && this.el) {
			this.#pinned = true;
			queueMicrotask(() => {
				if (this.el) this.el.scrollTop = this.el.scrollHeight;
				this.#pinned = false;
			});
			this.unseen = 0;
		} else this.unseen += added;
	}

	/** Only the user scrolling up stops following: a trim or a burst that moves the
	 * content under a pinned viewport must not (its scroll event lands after the pin). */
	onscroll = () => {
		const el = this.el;
		if (!el || this.#pinned) return;
		const st = el.scrollTop;
		const up = st < this.#lastScroll - 1;
		this.#lastScroll = st;
		this.scrollTop = st;
		const atBottom = el.scrollHeight - st - el.clientHeight < ROW * 2;
		if (atBottom) {
			this.follow = true;
			this.unseen = 0;
		} else if (up && this.follow) this.follow = false;
		else if (this.follow) el.scrollTop = el.scrollHeight;
	};

	toBottom() {
		this.follow = true;
		this.unseen = 0;
		if (this.el) this.el.scrollTop = this.el.scrollHeight;
	}

	scrollToRow(r: number, align: "nearest" | "center" = "center") {
		const el = this.el;
		if (!el) return;
		this.follow = false;
		untrack(() => this.#layout());
		const top = this.topOf(r);
		const h = this.wrap && this.#offsets[r + 1] !== undefined ? this.#offsets[r + 1] - top : ROW;
		if (align === "nearest") {
			if (top < el.scrollTop) el.scrollTop = top;
			else if (top + h > el.scrollTop + this.height) el.scrollTop = top + h - this.height;
		} else el.scrollTop = Math.max(0, top - (this.height - h) / 2);
		this.scrollTop = el.scrollTop;
	}

	/** Re-measure the monospace advance from the 20-char probe span. */
	measure(probe: HTMLSpanElement) {
		const w = probe.getBoundingClientRect().width / 20;
		if (w > 0 && Math.abs(w - this.charW) > 0.01) this.charW = w;
	}
}
