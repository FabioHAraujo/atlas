/** Virtualized page rendering: per-page canvas + text-layer slots, paint/release and bitmap eviction. */
import type { RenderTask, TextLayer } from "pdfjs-dist";
import { evictFar, type PageWindow } from "#lib/viewers/pdf.ts";
import { errorName, type PdfDoc } from "#lib/viewers/pdf/doc.ts";

type Slot = {
	canvas?: HTMLCanvasElement;
	text?: HTMLDivElement;
	task?: RenderTask;
	/** Active text layer; replaced (and cancelled) whenever the page is re-laid out. */
	tl?: TextLayer;
	/** Scale (css px per pdf pt × dpr) the canvas currently holds; 0 = empty. */
	done: number;
	busy: boolean;
	/** Scale of the render in flight, so identical requests are not started twice. */
	want?: number;
};

const KEEP_BITMAPS = 6;

export class PageSlots {
	private slots = new Map<number, Slot>();

	constructor(
		private doc: PdfDoc,
		private scale: () => number,
		/** Called once a page's text layer exists, so search highlights can be re-applied. */
		private onText: (i: number) => void,
		/** Called after a page bitmap lands, so its thumbnail can refresh. */
		private onPainted: (i: number) => void,
	) {}

	/** Text-layer host of page `i`, if mounted. */
	textHost = (i: number) => this.slots.get(i)?.text;
	indices = () => [...this.slots.keys()];

	private slotOf(i: number): Slot {
		let s = this.slots.get(i);
		if (!s) this.slots.set(i, (s = { done: 0, busy: false }));
		return s;
	}

	/** Svelte action: binds a page element's canvas and text layer to the renderer. */
	bind = (node: HTMLElement, i: number) => {
		const s = this.slotOf(i);
		s.canvas = node.querySelector("canvas")!;
		s.text = node.querySelector<HTMLDivElement>(".tl")!;
		s.done = 0;
		return {
			destroy: () => {
				this.release(i);
				this.slots.delete(i);
			},
		};
	};

	/** Renders page `i` at the current scale, crisp for the display; skips when already current. */
	private async paint(i: number) {
		const s = this.slotOf(i);
		const dpr = window.devicePixelRatio || 1;
		const want = this.scale() * dpr;
		if (!s.canvas || (s.done === want && !s.busy) || (s.busy && s.want === want)) return;
		s.task?.cancel();
		s.busy = true;
		s.want = want;
		const pg = await this.doc.page(i);
		// Scale changed while the page proxy resolved: a newer paint owns the slot.
		if (this.scale() * dpr !== want || !s.canvas) {
			s.busy = false;
			return;
		}
		const vp = pg.getViewport({ scale: want });
		const canvas = s.canvas;
		const next = document.createElement("canvas");
		next.width = Math.floor(vp.width);
		next.height = Math.floor(vp.height);
		const task = pg.render({ canvasContext: next.getContext("2d")!, canvas: next, viewport: vp });
		s.task = task;
		try {
			await task.promise;
		} catch (e) {
			if (errorName(e) !== "RenderingCancelledException") console.warn("pdf render", e);
			s.busy = false;
			return;
		}
		// Swap in the finished bitmap atomically so a re-render never flashes blank.
		canvas.width = next.width;
		canvas.height = next.height;
		canvas.getContext("2d")!.drawImage(next, 0, 0);
		s.done = want;
		s.busy = false;
		s.task = undefined;
		await this.paintText(i, this.scale());
		this.onPainted(i);
	}

	private async paintText(i: number, sc: number) {
		const s = this.slotOf(i);
		if (!s.text) return;
		const pg = await this.doc.page(i);
		// A newer paint may have started while the page proxy resolved; only the latest one renders.
		s.tl?.cancel();
		const host = s.text;
		host.replaceChildren();
		host.style.setProperty("--total-scale-factor", String(sc));
		const tl = (s.tl = new this.doc.pdfjs.TextLayer({
			textContentSource: pg.streamTextContent(),
			container: host,
			viewport: pg.getViewport({ scale: sc }),
		}));
		await tl.render().catch(() => {});
		if (s.tl === tl) this.onText(i);
	}

	private release(i: number) {
		const s = this.slots.get(i);
		if (!s) return;
		s.task?.cancel();
		s.task = undefined;
		s.busy = false;
		s.done = 0;
		if (s.canvas) {
			s.canvas.width = 0;
			s.canvas.height = 0;
		}
		s.tl?.cancel();
		s.tl = undefined;
		s.text?.replaceChildren();
	}

	/** Paints what the window needs (visible pages first) and releases bitmaps far from the viewport. */
	sync(range: PageWindow, page: number) {
		const [a, b] = range.near;
		const painted: number[] = [];
		for (const [i, s] of this.slots) if (s.done) painted.push(i);
		const [va, vb] = range.visible;
		const order: number[] = [];
		for (let i = va; i <= vb; i++) order.push(i);
		for (let i = a; i <= b; i++) if (i < va || i > vb) order.push(i);
		for (const i of order) void this.paint(i);
		const keep = Math.max(KEEP_BITMAPS, b - a + 1);
		for (const i of evictFar([...new Set([...painted, ...order])], page, keep)) this.release(i);
		for (const [i, s] of this.slots) if ((i < a || i > b) && (s.done || s.busy)) this.release(i);
	}

	/** Cancels every in-flight render (unmount). */
	cancelAll() {
		for (const s of this.slots.values()) s.task?.cancel();
	}
}
