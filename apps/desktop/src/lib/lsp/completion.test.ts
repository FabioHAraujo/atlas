// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { toCompletion } from "./completion.ts";

/** Headless view: `apply` only needs `state` and `dispatch`. */
function headless(doc: string, head: number) {
	const view = {
		state: EditorState.create({ doc, selection: { anchor: head } }),
		dispatch: (...specs) => {
			view.state = view.state.update(...specs).state;
		},
	};
	return view;
}
const env = { doc: { caps: null, request: async () => null } };
const pos = (line, character) => ({ line, character });
const range = (a, b) => ({ start: a, end: b });

function accept(doc, head, item, from, to) {
	const v = headless(doc, head);
	const c = toCompletion(v, env, item, {});
	c.apply(v, c, from, to);
	return v.state;
}

test("a plain item replaces the typed word and puts the caret after it", () => {
	const st = accept("let x = fo", 10, { label: "foo_bar" }, 8, 10);
	expect(st.doc.toString()).toBe("let x = foo_bar");
	expect(st.selection.main.head).toBe(15);
});

test("the server's textEdit range wins over the word CodeMirror matched (self.fo -> self.foo)", () => {
	const st = accept(
		"self.fo",
		7,
		{ label: "foo", textEdit: { range: range(pos(0, 5), pos(0, 7)), newText: "foo" } },
		5,
		7,
	);
	expect(st.doc.toString()).toBe("self.foo");
});

test("auto-import edits above the caret are applied in the same transaction and the caret shifts", () => {
	const doc = "fn main() {\n    HashM\n}";
	const head = doc.indexOf("HashM") + 5;
	const st = accept(
		doc,
		head,
		{
			label: "HashMap",
			additionalTextEdits: [
				{ range: range(pos(0, 0), pos(0, 0)), newText: "use std::collections::HashMap;\n" },
			],
		},
		head - 5,
		head,
	);
	expect(st.doc.toString()).toBe("use std::collections::HashMap;\nfn main() {\n    HashMap\n}");
	expect(st.selection.main.head).toBe(st.doc.toString().indexOf("HashMap\n}") + 7);
});

test("a snippet with tab stops starts a snippet session; braces stay literal", () => {
	const st = accept(
		"pr",
		2,
		{ label: "println!", insertTextFormat: 2, insertText: "println!(${1:msg}) { $0 }" },
		0,
		2,
	);
	expect(st.doc.toString()).toBe("println!(msg) {  }");
});

test("a snippet without tab stops inserts plain text (escapes undone)", () => {
	const st = accept("x", 1, { label: "f", insertTextFormat: 2, insertText: "f() { }" }, 0, 1);
	expect(st.doc.toString()).toBe("f() { }");
});
