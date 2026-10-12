/**
 * Bracket pair colorization: `({[` and `)}]` get a depth class `cm-bracket-0..5` (cycling), themed
 * through `--cm-bracket-1..6`. Viewport-bounded: only the visible ranges are scanned, strings and
 * comments (from the Lezer tree) are skipped, and the work stops at `MAX_BRACKETS` per update.
 *
 * Depth is relative to the first visible line: a viewport that starts inside a block begins at depth
 * 0 (cheap and stable while typing) except that an unmatched closer never goes below 0.
 */
import { syntaxTree } from "@codemirror/language";
import { RangeSetBuilder, type Extension } from "@codemirror/state";
import {
	Decoration,
	ViewPlugin,
	type DecorationSet,
	type EditorView,
	type ViewUpdate,
} from "@codemirror/view";

export const BRACKET_CLASSES = 6;
export const MAX_BRACKETS = 5_000;

/** Tree nodes whose text is never code (brackets inside are plain characters). */
const SKIP_NODE =
	/^(String|TemplateString|Comment|LineComment|BlockComment|RawString|CharLiteral|Char|Regex|RegExp|StringLiteral|Str)/;

const OPEN = "({[";
const CLOSE = ")}]";

export interface Bracket {
	pos: number;
	/** Depth class index, `0..BRACKET_CLASSES - 1`. */
	depth: number;
}

/**
 * Brackets of `text` (positions are `base + offset`), skipping `skip` (sorted, non-overlapping
 * `[from, to)` ranges in the same coordinates). `depth` starts at `startDepth` and is carried across
 * calls through the returned `depth`, so several visible ranges share one counter.
 */
export function scanBrackets(
	text: string,
	base: number,
	skip: readonly (readonly [number, number])[],
	startDepth: number,
	limit: number,
): { brackets: Bracket[]; depth: number; truncated: boolean } {
	const out: Bracket[] = [];
	let depth = startDepth;
	let s = 0;
	let i = 0;
	while (i < text.length) {
		const abs = base + i;
		while (s < skip.length && skip[s][1] <= abs) s++;
		if (s < skip.length && skip[s][0] <= abs) {
			i = skip[s][1] - base;
			continue;
		}
		const c = text[i];
		const o = OPEN.indexOf(c);
		if (o >= 0) {
			out.push({ pos: abs, depth: depth % BRACKET_CLASSES });
			depth++;
		} else if (CLOSE.indexOf(c) >= 0) {
			if (depth > 0) depth--;
			out.push({ pos: abs, depth: depth % BRACKET_CLASSES });
		}
		if (out.length >= limit) return { brackets: out, depth, truncated: true };
		i++;
	}
	return { brackets: out, depth, truncated: false };
}

const marks = Array.from({ length: BRACKET_CLASSES }, (_, i) =>
	Decoration.mark({ class: `cm-bracket-${i}` }),
);

/** Ranges of strings/comments inside `[from, to)` from the syntax tree (empty when there is no grammar). */
function skipRanges(view: EditorView, from: number, to: number): [number, number][] {
	const out: [number, number][] = [];
	syntaxTree(view.state).iterate({
		from,
		to,
		enter: (n) => {
			if (!SKIP_NODE.test(n.name)) return;
			out.push([n.from, n.to]);
			return false;
		},
	});
	return out;
}

function build(view: EditorView): DecorationSet {
	const b = new RangeSetBuilder<Decoration>();
	let depth = 0;
	let budget = MAX_BRACKETS;
	for (const { from, to } of view.visibleRanges) {
		const r = scanBrackets(view.state.sliceDoc(from, to), from, skipRanges(view, from, to), depth, budget);
		for (const br of r.brackets) b.add(br.pos, br.pos + 1, marks[br.depth]);
		depth = r.depth;
		budget -= r.brackets.length;
		if (r.truncated || budget <= 0) break;
	}
	return b.finish();
}

const plugin = ViewPlugin.fromClass(
	class {
		decorations: DecorationSet;
		constructor(view: EditorView) {
			this.decorations = build(view);
		}
		update(u: ViewUpdate) {
			if (u.docChanged || u.viewportChanged || syntaxTree(u.state) !== syntaxTree(u.startState))
				this.decorations = build(u.view);
		}
	},
	{ decorations: (v) => v.decorations },
);

/** Bracket pair colorization; add or remove it through a compartment (`Features.bracketColors`). */
export const bracketColors: Extension = plugin;
