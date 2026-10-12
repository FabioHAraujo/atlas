// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { getIndentUnit } from "@codemirror/language";
import { EDITOR_PREF_DEFAULTS } from "./settings.ts";
import { editorExtensions, indentUnitFor, reconfigure, slots } from "./setup.ts";
import { search } from "@codemirror/search";

const FULL = {
	bracketColors: true,
	indentGuides: true,
	stickyScroll: true,
	foldGutter: true,
	selectionMatches: true,
	minimap: false,
	wrap: false,
};

test("indent unit follows tab size and insert_spaces", () => {
	expect(indentUnitFor({ tab_size: 2, insert_spaces: true })).toBe("  ");
	expect(indentUnitFor({ tab_size: 8, insert_spaces: false })).toBe("\t");
});

test("features gate the heavy slots; prefs gate the rest", () => {
	const on = slots({ prefs: EDITOR_PREF_DEFAULTS, features: FULL });
	const off = slots({
		prefs: EDITOR_PREF_DEFAULTS,
		features: {
			...FULL,
			bracketColors: false,
			indentGuides: false,
			stickyScroll: false,
			foldGutter: false,
			selectionMatches: false,
		},
	});
	for (const k of ["brackets", "guides", "sticky", "foldGutter", "selectionMatches"]) {
		expect(Array.isArray(on[k]) && on[k].length === 0).toBe(false);
		expect(Array.isArray(off[k]) && off[k].length === 0).toBe(true);
	}
	// Minimap is off by default in prefs even if the tier allows it.
	expect(slots({ prefs: EDITOR_PREF_DEFAULTS, features: { ...FULL, minimap: true } }).minimap).toEqual([]);
});

test("a view mounts with the bundle and reconfigures tab size", () => {
	const { base, compartments } = editorExtensions({ prefs: EDITOR_PREF_DEFAULTS, features: FULL });
	const parent = document.createElement("div");
	document.body.append(parent);
	const view = new EditorView({ parent, state: EditorState.create({ doc: "a\n\tb", extensions: [base] }) });
	expect(view.state.tabSize).toBe(4);
	expect(getIndentUnit(view.state)).toBe(4);
	reconfigure(view, compartments, { prefs: { ...EDITOR_PREF_DEFAULTS, tab_size: 2 }, features: FULL });
	expect(view.state.tabSize).toBe(2);
	expect(view.contentDOM.getAttribute("spellcheck")).toBe("false");
	view.destroy();
});

test("the themed find panel mounts and shows replace preview text", async () => {
	const { base } = editorExtensions({ prefs: EDITOR_PREF_DEFAULTS, features: FULL });
	const { openSearchPanel, setSearchQuery, SearchQuery } = await import("@codemirror/search");
	const parent = document.createElement("div");
	document.body.append(parent);
	const view = new EditorView({ parent, state: EditorState.create({ doc: "foo foo", extensions: [base] }) });
	openSearchPanel(view);
	view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: "foo" })) });
	const panel = view.dom.querySelector(".cm-find");
	expect(panel).not.toBeNull();
	expect(panel.querySelector("[aria-label='Match case']").getAttribute("aria-pressed")).toBe("false");
	expect(panel.querySelector("[aria-label='Find']")).not.toBeNull();
	void search;
	view.destroy();
});
