/**
 * Canvas minimap: one thin block per line (its indent and length), scaled to the minimap height,
 * with a slider showing the viewport. Cheap by construction: it only draws on `rAF`, only reads
 * line *lengths* (`doc.line(n)`), samples when the document has more lines than pixels, and the
 * whole plugin is absent unless `Features.minimap` is on. Click or drag scrolls the editor.
 */
import type { Extension, Text } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

export const MINIMAP_WIDTH = 72;
/** Pixel rows per source line before sampling kicks in. */
const ROW_PX = 2;
/** Source columns mapped to the full width. */
const COLS = 120;

export interface MinimapRow {
	/** Indent in columns (clamped to `COLS`). */
	indent: number;
	/** Text length after the indent in columns (clamped to `COLS`). */
	len: number;
}

/**
 * Rows to draw for `doc` into `rows` pixel-rows of `ROW_PX` each: every line when it fits, otherwise
 * evenly sampled lines. `null` entries are blank lines (nothing is drawn).
 */
export function minimapRows(doc: Text, rows: number): (MinimapRow | null)[] {
	const n = doc.lines;
	const slots = Math.max(1, Math.floor(rows / ROW_PX));
	const count = Math.min(n, slots);
	const out: (MinimapRow | null)[] = [];
	for (let i = 0; i < count; i++) {
		const ln = count === n ? i + 1 : 1 + Math.floor((i * n) / count);
		const text = doc.line(ln).text;
		let indent = 0;
		while (indent < text.length && (text.charCodeAt(indent) === 32 || text.charCodeAt(indent) === 9))
			indent++;
		const len = text.trimEnd().length - indent;
		out.push(
			len > 0 ? { indent: Math.min(indent, COLS), len: Math.min(len, COLS - Math.min(indent, COLS)) } : null,
		);
	}
	return out;
}

/** Scroll offset for a pointer at `y` (px from the minimap top) so the viewport is centered on it. */
export function scrollForPointer(
	y: number,
	mapHeight: number,
	scrollHeight: number,
	clientHeight: number,
): number {
	const target = (y / Math.max(1, mapHeight)) * scrollHeight - clientHeight / 2;
	return Math.max(0, Math.min(scrollHeight - clientHeight, target));
}

class Minimap {
	private wrap: HTMLElement;
	private canvas: HTMLCanvasElement;
	private slider: HTMLElement;
	private frame = 0;
	private dragging = false;

	constructor(private view: EditorView) {
		this.wrap = document.createElement("div");
		this.wrap.className = "cm-minimap";
		this.wrap.setAttribute("aria-hidden", "true");
		this.canvas = document.createElement("canvas");
		this.slider = document.createElement("div");
		this.slider.className = "cm-minimap-slider";
		this.wrap.append(this.canvas, this.slider);
		view.dom.append(this.wrap);

		this.onScroll = this.onScroll.bind(this);
		view.scrollDOM.addEventListener("scroll", this.onScroll, { passive: true });
		this.wrap.addEventListener("pointerdown", (e) => {
			this.dragging = true;
			this.wrap.setPointerCapture(e.pointerId);
			this.seek(e);
		});
		this.wrap.addEventListener("pointermove", (e) => this.dragging && this.seek(e));
		const stop = () => (this.dragging = false);
		this.wrap.addEventListener("pointerup", stop);
		this.wrap.addEventListener("pointercancel", stop);
		this.schedule();
	}

	update(u: ViewUpdate) {
		if (u.docChanged || u.geometryChanged || u.viewportChanged) this.schedule();
	}

	destroy() {
		if (this.frame) cancelAnimationFrame(this.frame);
		this.view.scrollDOM.removeEventListener("scroll", this.onScroll);
		this.wrap.remove();
	}

	private onScroll() {
		this.schedule();
	}

	private seek(e: PointerEvent) {
		const sc = this.view.scrollDOM;
		const r = this.wrap.getBoundingClientRect();
		sc.scrollTop = scrollForPointer(e.clientY - r.top, r.height, sc.scrollHeight, sc.clientHeight);
	}

	private schedule() {
		if (this.frame) return;
		this.frame = requestAnimationFrame(() => {
			this.frame = 0;
			this.draw();
		});
	}

	private draw() {
		const sc = this.view.scrollDOM;
		const h = this.wrap.clientHeight;
		if (h <= 0) return;
		const dpr = window.devicePixelRatio || 1;
		const w = MINIMAP_WIDTH;
		if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
			this.canvas.width = w * dpr;
			this.canvas.height = h * dpr;
			this.canvas.style.width = `${w}px`;
			this.canvas.style.height = `${h}px`;
		}
		const ctx = this.canvas.getContext("2d");
		if (!ctx) return;
		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		ctx.fillStyle = getComputedStyle(this.wrap).color;
		const rows = minimapRows(this.view.state.doc, h);
		const rowH = h / Math.max(1, rows.length);
		const colW = w / COLS;
		ctx.globalAlpha = 0.55;
		for (let i = 0; i < rows.length; i++) {
			const r = rows[i];
			if (r) ctx.fillRect(r.indent * colW, i * rowH, Math.max(1, r.len * colW), Math.max(1, rowH - 0.5));
		}
		ctx.globalAlpha = 1;
		// Slider: the visible fraction of the document.
		const total = Math.max(1, sc.scrollHeight);
		const top = (sc.scrollTop / total) * h;
		this.slider.style.top = `${top}px`;
		this.slider.style.height = `${Math.max(8, (sc.clientHeight / total) * h)}px`;
	}
}

const minimapTheme = EditorView.baseTheme({
	".cm-minimap": {
		position: "absolute",
		top: 0,
		right: 0,
		bottom: 0,
		width: `${MINIMAP_WIDTH}px`,
		zIndex: 4,
		borderLeft: "0.5px solid var(--ca-outline-subtle)",
		cursor: "default",
		touchAction: "none",
		color: "var(--cm-minimap-fg, var(--ca-text-secondary))",
	},
	".cm-minimap canvas": { display: "block" },
	".cm-minimap-slider": {
		position: "absolute",
		left: 0,
		right: 0,
		background: "color-mix(in oklab, var(--ca-text-primary) 10%, transparent)",
		pointerEvents: "none",
	},
	".cm-minimap:hover .cm-minimap-slider": {
		background: "color-mix(in oklab, var(--ca-text-primary) 16%, transparent)",
	},
	// Reserve the strip so text and the scrollbar do not run underneath.
	"&.cm-has-minimap .cm-scroller": { paddingRight: `${MINIMAP_WIDTH}px` },
});

const hostClass = EditorView.editorAttributes.of({ class: "cm-has-minimap" });

/** Minimap; add only when `Features.minimap` is on (through a compartment). */
export const minimap: Extension = [ViewPlugin.fromClass(Minimap), minimapTheme, hostClass];
