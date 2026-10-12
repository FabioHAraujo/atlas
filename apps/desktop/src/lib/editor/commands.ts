/**
 * Editor commands that are not in `@codemirror/commands` (join lines, sort lines, case changes,
 * indentation conversion, trim whitespace, shrink selection…). Each one is a `StateCommand`
 * (`({state, dispatch}) => boolean`), so tests run them against a bare `EditorState`.
 */
import { indentMore, selectParentSyntax } from "@codemirror/commands";
import { getIndentUnit, indentString } from "@codemirror/language";
import {
	EditorSelection,
	type ChangeSpec,
	type EditorState,
	type SelectionRange,
	type StateCommand,
	type Transaction,
} from "@codemirror/state";
import { trimTrailingWhitespace } from "#lib/editor/detect.ts";

/** Inclusive line numbers touched by the selection (a range ending at column 0 does not include that line). */
function selectedLines(state: EditorState): { from: number; to: number } {
	let from = Infinity;
	let to = 0;
	for (const r of state.selection.ranges) {
		const a = state.doc.lineAt(r.from).number;
		let b = state.doc.lineAt(r.to).number;
		if (!r.empty && b > a && state.doc.line(b).from === r.to) b--;
		from = Math.min(from, a);
		to = Math.max(to, b);
	}
	return { from, to };
}

function apply(
	state: EditorState,
	dispatch: (tr: Transaction) => void,
	changes: ChangeSpec,
	userEvent: string,
): true {
	dispatch(state.update({ changes, userEvent, scrollIntoView: true }));
	return true;
}

/** Join the selected lines (or the caret line with the next) with a single space, VS Code style. */
export const joinLines: StateCommand = ({ state, dispatch }) => {
	const { from, to } = selectedLines(state);
	const end = Math.min(state.doc.lines, Math.max(to, from + 1));
	if (end === from) return false;
	const changes: ChangeSpec[] = [];
	for (let n = from; n < end; n++) {
		const cur = state.doc.line(n);
		const next = state.doc.line(n + 1);
		const lead = /^\s*/.exec(next.text)?.[0].length ?? 0;
		const glue = cur.text.trimEnd().length === 0 || next.text.length === lead ? "" : " ";
		changes.push({ from: cur.to, to: next.from + lead, insert: glue });
	}
	return apply(state, dispatch, changes, "input.join");
};

/** Sort the selected lines (the whole document when no range spans lines), natural order, case-insensitive. */
export function sortLines(descending: boolean): StateCommand {
	return ({ state, dispatch }) => {
		const multi = state.selection.ranges.some(
			(r) => state.doc.lineAt(r.from).number !== state.doc.lineAt(r.to).number,
		);
		const range = multi ? selectedLines(state) : { from: 1, to: state.doc.lines };
		const lines: string[] = [];
		for (let n = range.from; n <= range.to; n++) lines.push(state.doc.line(n).text);
		const sorted = [...lines].sort((a, b) =>
			a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" }),
		);
		if (descending) sorted.reverse();
		if (sorted.every((l, i) => l === lines[i])) return false;
		const change = {
			from: state.doc.line(range.from).from,
			to: state.doc.line(range.to).to,
			insert: sorted.join("\n"),
		};
		return apply(state, dispatch, change, "input.sort");
	};
}

/** Transform each selected range's text (the word at an empty caret) with `fn`; the selection is kept. */
function mapSelection(fn: (s: string) => string): StateCommand {
	return ({ state, dispatch }) => {
		const changes: ChangeSpec[] = [];
		for (const r of state.selection.ranges) {
			const span: SelectionRange | null = r.empty ? state.wordAt(r.head) : r;
			if (!span) continue;
			const text = state.sliceDoc(span.from, span.to);
			const out = fn(text);
			if (out !== text) changes.push({ from: span.from, to: span.to, insert: out });
		}
		return changes.length ? apply(state, dispatch, changes, "input.case") : false;
	};
}

export const uppercase = mapSelection((s) => s.toUpperCase());
export const lowercase = mapSelection((s) => s.toLowerCase());

/** Leading whitespace of every line → `style`; a tab counts to the next tab stop. */
export function convertIndentation(style: "space" | "tab"): StateCommand {
	return ({ state, dispatch }) => {
		const tab = state.tabSize;
		const changes: ChangeSpec[] = [];
		for (let n = 1; n <= state.doc.lines; n++) {
			const line = state.doc.line(n);
			const lead = /^[ \t]+/.exec(line.text)?.[0];
			if (!lead) continue;
			let cols = 0;
			for (const c of lead) cols += c === "\t" ? tab - (cols % tab) : 1;
			const want =
				style === "tab" ? "\t".repeat(Math.floor(cols / tab)) + " ".repeat(cols % tab) : " ".repeat(cols);
			if (want !== lead) changes.push({ from: line.from, to: line.from + lead.length, insert: want });
		}
		return changes.length ? apply(state, dispatch, changes, "input.indent") : false;
	};
}

/** Smallest single replace turning `a` into `b` (keeps selections and undo granularity sane). */
export function minimalChange(a: string, b: string): { from: number; to: number; insert: string } {
	let s = 0;
	const max = Math.min(a.length, b.length);
	while (s < max && a.charCodeAt(s) === b.charCodeAt(s)) s++;
	let ea = a.length;
	let eb = b.length;
	while (ea > s && eb > s && a.charCodeAt(ea - 1) === b.charCodeAt(eb - 1)) {
		ea--;
		eb--;
	}
	return { from: s, to: ea, insert: b.slice(s, eb) };
}

/** Remove trailing whitespace on every line. */
export const trimWhitespace: StateCommand = ({ state, dispatch }) => {
	const text = state.doc.toString();
	const out = trimTrailingWhitespace(text);
	return out === text ? false : apply(state, dispatch, minimalChange(text, out), "delete.trim");
};

/** Expand/shrink selection: the stack of previous selections per document, valid while nothing else moved the selection. */
interface ExpandMemo {
	stack: EditorSelection[];
	last: EditorSelection;
}
const memo = new WeakMap<object, ExpandMemo>();

/** Expand the selection to the enclosing syntax node, remembering the step for `shrinkSelection`. */
export const expandSelection: StateCommand = ({ state, dispatch }) => {
	let next: EditorSelection | undefined;
	if (!selectParentSyntax({ state, dispatch: (tr) => (next = tr.state.selection) }) || !next) return false;
	const prev = memo.get(state.doc);
	const stack = prev && prev.last.eq(state.selection) ? prev.stack : [];
	stack.push(state.selection);
	memo.set(state.doc, { stack, last: next });
	dispatch(state.update({ selection: next, scrollIntoView: true, userEvent: "select.syntax" }));
	return true;
};

/** Undo the last `expandSelection` step. */
export const shrinkSelection: StateCommand = ({ state, dispatch }) => {
	const m = memo.get(state.doc);
	const sel = m?.last.eq(state.selection) ? m.stack.pop() : undefined;
	if (!m || !sel) return false;
	m.last = sel;
	dispatch(state.update({ selection: sel, scrollIntoView: true, userEvent: "select.syntax" }));
	return true;
};

/** Text Tab inserts at `pos`: spaces up to the next indent-unit stop, or a tab when the unit is a tab. */
function tabInsert(state: EditorState, pos: number): string {
	const unit = getIndentUnit(state);
	if (indentString(state, unit).includes("\t")) return "\t";
	return " ".repeat(unit - ((pos - state.doc.lineAt(pos).from) % unit));
}

/** Tab: indent the selected lines, or insert one indent step at carets / single-line selections. */
export const indentOrInsert: StateCommand = (target) => {
	const { state, dispatch } = target;
	if (state.selection.ranges.some((r) => state.doc.lineAt(r.from).number !== state.doc.lineAt(r.to).number))
		return indentMore(target);
	dispatch(
		state.update(
			state.changeByRange((r) => {
				const ins = tabInsert(state, r.from);
				return {
					changes: { from: r.from, to: r.to, insert: ins },
					range: EditorSelection.cursor(r.from + ins.length),
				};
			}),
			{ userEvent: "input", scrollIntoView: true },
		),
	);
	return true;
};
