/** In-document PDF search: debounced match collection, current-match stepping and `<mark>` highlighting. */
import { findMatches, stepMatch, type Match } from "#lib/viewers/pdf.ts";
import type { PdfDoc } from "#lib/viewers/pdf/doc.ts";

const DEBOUNCE_MS = 180;

/** What the search needs from the viewer: the page owning the viewport, text-layer hosts and reveal. */
export type SearchHost = {
	doc: PdfDoc;
	page: () => number;
	textHost: (i: number) => HTMLElement | undefined;
	pagesWithText: () => number[];
	reveal: (m: Match) => void;
};

export class PdfSearch {
	open = $state(false);
	query = $state("");
	matches = $state<Match[]>([]);
	cur = $state(-1);
	searching = $state(false);
	private run = 0;
	private debounce = 0;

	constructor(private host: SearchHost) {}

	/** Re-applies highlights on every page that has a text layer. */
	private highlightAll() {
		for (const i of this.host.pagesWithText()) this.highlight(i);
	}

	close() {
		this.open = false;
		this.query = "";
		this.matches = [];
		this.cur = -1;
		this.highlightAll();
	}

	/** Debounced entry point for the input's `oninput`. */
	schedule() {
		clearTimeout(this.debounce);
		this.debounce = window.setTimeout(() => void this.search(), DEBOUNCE_MS);
	}

	dispose() {
		clearTimeout(this.debounce);
	}

	private async search() {
		const run = ++this.run;
		const q = this.query;
		if (!q.trim()) {
			this.matches = [];
			this.cur = -1;
			this.highlightAll();
			return;
		}
		this.searching = true;
		const found: Match[] = [];
		for (let i = 0; i < this.host.doc.numPages; i++) {
			const t = await this.host.doc.text(i);
			if (run !== this.run) return;
			found.push(...findMatches(t, q, i));
		}
		this.searching = false;
		this.matches = found;
		// Start at the first match on/after the current page.
		const first = found.findIndex((m) => m.page >= this.host.page());
		this.cur = found.length ? (first === -1 ? 0 : first) : -1;
		this.highlightAll();
		this.revealCurrent();
	}

	next(dir: 1 | -1) {
		if (!this.matches.length) return;
		this.cur = stepMatch(this.cur, this.matches.length, dir);
		this.highlightAll();
		this.revealCurrent();
	}

	private revealCurrent() {
		const m = this.matches[this.cur];
		if (m) this.host.reveal(m);
	}

	/** Wraps this page's matches in `<mark>` inside its text layer spans. */
	highlight(i: number) {
		const host = this.host.textHost(i);
		if (!host) return;
		for (const m of host.querySelectorAll("mark.hit")) m.replaceWith(...m.childNodes);
		host.normalize();
		const list = this.matches.map((m, idx) => ({ m, idx })).filter((x) => x.m.page === i);
		if (!list.length) return;
		// Text layer spans concatenate to the same string PdfDoc.text() built (marked content aside).
		const spans = [
			...host.querySelectorAll<HTMLElement>(
				":scope > span:not(.markedContent), :scope > .markedContent > span",
			),
		];
		let off = 0;
		let li = 0;
		for (const sp of spans) {
			const len = sp.textContent?.length ?? 0;
			const lo = off;
			const hi = off + len;
			off = hi;
			while (li < list.length && list[li].m.end <= lo) li++;
			// Process matches overlapping [lo, hi) for this span, right to left so offsets hold.
			const here: { s: number; e: number; cur: boolean }[] = [];
			for (let k = li; k < list.length && list[k].m.start < hi; k++) {
				const { m, idx } = list[k];
				here.push({ s: Math.max(m.start, lo) - lo, e: Math.min(m.end, hi) - lo, cur: idx === this.cur });
			}
			if (!here.length || !sp.firstChild || sp.firstChild.nodeType !== Node.TEXT_NODE) continue;
			for (const h of here.reverse()) {
				const tn = sp.firstChild as Text;
				const range = document.createRange();
				range.setStart(tn, h.s);
				range.setEnd(tn, h.e);
				const mark = document.createElement("mark");
				mark.className = h.cur ? "hit cur" : "hit";
				range.surroundContents(mark);
				// surroundContents splits the text node; the head stays first for the next (earlier) match.
			}
		}
	}
}
