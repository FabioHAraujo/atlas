/**
 * Visual aids drawn from the viewport only: indent guides, rulers and whitespace rendering.
 * Pure cores (`indentLevels`, `activeGuide`, `whitespaceRanges`) take text/arrays so they are
 * testable without a DOM; the plugins below only translate them into decorations.
 */
import { getIndentUnit } from "@codemirror/language";
import { RangeSetBuilder, type Extension, type Text } from "@codemirror/state";
import {
	Decoration,
	EditorView,
	ViewPlugin,
	layer,
	RectangleMarker,
	type DecorationSet,
	type ViewUpdate,
} from "@codemirror/view";

/** Visual width of a line's leading whitespace in columns (tabs advance to the next tab stop); -1 for blank lines. */
export function indentColumns(line: string, tabSize: number): number {
	let col = 0;
	for (let i = 0; i < line.length; i++) {
		const c = line.charCodeAt(i);
		if (c === 32) col++;
		else if (c === 9) col += tabSize - (col % tabSize);
		else return col;
	}
	return -1;
}

/**
 * Indent depth (in indent units) per line. Blank lines take the smaller of the surrounding
 * non-blank depths so a guide runs unbroken through empty lines inside a block. `before`/`after`
 * are the depth of the nearest non-blank line outside the slice (`0` when unknown).
 */
export function indentLevels(
	lines: readonly string[],
	tabSize: number,
	unit: number,
	before = 0,
	after = 0,
): number[] {
	const u = Math.max(1, unit);
	const cols = lines.map((l) => indentColumns(l, tabSize));
	const out = new Array<number>(lines.length);
	let next = after;
	const nextNonBlank = new Array<number>(lines.length);
	for (let i = lines.length - 1; i >= 0; i--) {
		if (cols[i] >= 0) next = Math.floor(cols[i] / u);
		nextNonBlank[i] = next;
	}
	let prev = before;
	for (let i = 0; i < lines.length; i++) {
		if (cols[i] >= 0) {
			prev = Math.floor(cols[i] / u);
			out[i] = prev;
		} else out[i] = Math.min(prev, nextNonBlank[i]);
	}
	return out;
}

/**
 * The guide the caret line belongs to: its 1-based `level` and the inclusive index range of
 * consecutive lines that keep at least that depth. `null` when the line has no guide (depth 0).
 */
export function activeGuide(
	levels: readonly number[],
	index: number,
): { level: number; from: number; to: number } | null {
	const level = levels[index];
	if (!level) return null;
	let from = index;
	let to = index;
	while (from > 0 && levels[from - 1] >= level) from--;
	while (to < levels.length - 1 && levels[to + 1] >= level) to++;
	return { level, from, to };
}

const GUIDE_COLOR = "var(--cm-indent-guide, color-mix(in oklab, var(--ca-text-primary) 9%, transparent))";
const GUIDE_ACTIVE =
	"var(--cm-indent-guide-active, color-mix(in oklab, var(--ca-text-primary) 28%, transparent))";

const lineDecos = new Map<string, Decoration>();

/**
 * One line decoration per (levels, active level, unit) combination: `repeating-linear-gradient` in
 * `ch` units draws one 1px line per indent unit; the active level is a second, brighter gradient
 * clipped to that single column. Cached: a document only ever has a handful of distinct shapes.
 */
function guideDeco(level: number, unit: number, active: number): Decoration {
	const key = `${level}:${unit}:${active}`;
	let d = lineDecos.get(key);
	if (d) return d;
	const w = `${unit}ch`;
	const hasActive = active > 0 && active <= level;
	const layers: string[] = [];
	const sizes: string[] = [];
	if (hasActive) {
		layers.push(`linear-gradient(to right, ${GUIDE_ACTIVE} 0 1px, transparent 1px)`);
		sizes.push(`${w} 100%`);
	}
	layers.push(`repeating-linear-gradient(to right, ${GUIDE_COLOR} 0 1px, transparent 1px ${w})`);
	sizes.push(`${level * unit}ch 100%`);
	const pos = hasActive ? `${(active - 1) * unit}ch 0, 0 0` : "0 0";
	d = Decoration.line({
		attributes: {
			class: "cm-indent-guides",
			style: `background-image:${layers.join(",")};background-size:${sizes.join(",")};background-position:${pos};background-repeat:no-repeat`,
		},
	});
	lineDecos.set(key, d);
	return d;
}

/** Guides beyond this depth are not drawn (pathological indentation). */
const MAX_GUIDE_LEVEL = 24;

function buildGuides(view: EditorView): DecorationSet {
	const { state } = view;
	const unit = Math.max(1, getIndentUnit(state));
	const tab = state.tabSize;
	const b = new RangeSetBuilder<Decoration>();
	const head = state.doc.lineAt(state.selection.main.head).number;
	for (const { from, to } of view.visibleRanges) {
		const first = state.doc.lineAt(from).number;
		const last = state.doc.lineAt(to).number;
		const texts: string[] = [];
		for (let n = first; n <= last; n++) texts.push(state.doc.line(n).text);
		const before = edgeLevel(state.doc, first, -1, tab, unit);
		const after = edgeLevel(state.doc, last, 1, tab, unit);
		const levels = indentLevels(texts, tab, unit, before, after);
		const act = head >= first && head <= last ? activeGuide(levels, head - first) : null;
		for (let i = 0; i < levels.length; i++) {
			const level = Math.min(levels[i], MAX_GUIDE_LEVEL);
			if (level < 1) continue;
			const active = act && i >= act.from && i <= act.to ? Math.min(act.level, level) : 0;
			b.add(state.doc.line(first + i).from, state.doc.line(first + i).from, guideDeco(level, unit, active));
		}
	}
	return b.finish();
}

/** Depth of the nearest non-blank line beyond `n` in `dir`, looking at most 200 lines out. */
function edgeLevel(doc: Text, n: number, dir: 1 | -1, tab: number, unit: number): number {
	for (let i = 1, k = n + dir; i <= 200 && k >= 1 && k <= doc.lines; i++, k += dir) {
		const c = indentColumns(doc.line(k).text, tab);
		if (c >= 0) return Math.floor(c / unit);
	}
	return 0;
}

/** Vertical indent guides for every visible line; the caret's block is highlighted. */
export const indentGuides: Extension = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = buildGuides(view);
		}
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged || u.selectionSet || u.startState.tabSize !== u.state.tabSize)
				this.decorations = buildGuides(u.view);
		}
	},
	{ decorations: (v) => v.decorations },
);

/** Vertical rulers at the given 1-based columns, drawn in a layer behind the text. */
export function rulers(columns: readonly number[]): Extension {
	if (!columns.length) return [];
	return layer({
		above: false,
		class: "cm-rulers",
		update: (u) => u.docChanged || u.viewportChanged || u.geometryChanged,
		markers(view) {
			const left = view.contentDOM.getBoundingClientRect().left - view.scrollDOM.getBoundingClientRect().left;
			const pad = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0;
			const h = view.contentHeight;
			return columns.map(
				(col) => new RectangleMarker("cm-ruler", left + pad + view.defaultCharacterWidth * col, 0, 1, h),
			);
		},
	});
}

export type WhitespaceMode = "none" | "selection" | "all";

export interface WsRange {
	from: number;
	to: number;
	kind: "space" | "tab";
}

/** Space/tab runs in `text` (positions are `base + offset`) restricted to `within` ranges when given. */
export function whitespaceRanges(
	text: string,
	base: number,
	within?: readonly (readonly [number, number])[],
): WsRange[] {
	const out: WsRange[] = [];
	const scan = (a: number, b: number) => {
		for (let i = a; i < b; i++) {
			const c = text.charCodeAt(i);
			if (c === 32) out.push({ from: base + i, to: base + i + 1, kind: "space" });
			else if (c === 9) out.push({ from: base + i, to: base + i + 1, kind: "tab" });
		}
	};
	if (!within) scan(0, text.length);
	else
		for (const [f, t] of within) {
			const a = Math.max(0, f - base);
			const z = Math.min(text.length, t - base);
			if (z > a) scan(a, z);
		}
	return out;
}

const spaceMark = Decoration.mark({ class: "cm-ws cm-ws-space" });
const tabMark = Decoration.mark({ class: "cm-ws cm-ws-tab" });
/** Whitespace marks stop here per viewport (a minified-then-indented megafile cannot stall typing). */
const MAX_WS = 20_000;

function buildWhitespace(view: EditorView, mode: WhitespaceMode): DecorationSet {
	const b = new RangeSetBuilder<Decoration>();
	const sel = view.state.selection.ranges.filter((r) => !r.empty).map((r) => [r.from, r.to] as const);
	if (mode === "selection" && !sel.length) return b.finish();
	let count = 0;
	for (const { from, to } of view.visibleRanges) {
		const text = view.state.sliceDoc(from, to);
		const within = mode === "selection" ? sel.filter(([f, t]) => t > from && f < to) : undefined;
		for (const r of whitespaceRanges(text, from, within)) {
			b.add(r.from, r.to, r.kind === "tab" ? tabMark : spaceMark);
			if (++count >= MAX_WS) return b.finish();
		}
	}
	return b.finish();
}

/** `render_whitespace`: `·` for spaces and `→` for tabs (all, or only inside selections). */
export function renderWhitespace(mode: WhitespaceMode): Extension {
	if (mode === "none") return [];
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) {
				this.decorations = buildWhitespace(view, mode);
			}
			update(u: ViewUpdate) {
				if (u.docChanged || u.viewportChanged || (mode === "selection" && u.selectionSet))
					this.decorations = buildWhitespace(u.view, mode);
			}
		},
		{ decorations: (v) => v.decorations },
	);
}
