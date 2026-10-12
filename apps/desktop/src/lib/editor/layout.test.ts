// @ts-nocheck bun test runtime types are not part of the app tsconfig
import "../../../test/setup.ts";
import { expect, test } from "bun:test";

// Layout is not computed in happy-dom, so this pins the structural contract that keeps the editor
// the size of its pane whatever the document holds (the bug: it followed the longest line). The
// real measurement is a desktop:dev check (docs/editor.md, "Verifying the layout").
// Dynamic on purpose: the DOM setup above must exist before CodeMirror (and cm.ts) load; static
// imports are hoisted above it.
const { EditorView } = await import("codemirror");
const { EditorState } = await import("@codemirror/state");
const { atlasTheme } = await import("#lib/cm.ts");

function css(): string {
	return [...document.querySelectorAll("style")].map((s) => s.textContent ?? "").join("\n");
}

/** All declarations of every rule whose selector ends in `sel` (CM scopes rules under `.ͼN`). */
function rule(sheet: string, sel: string): string {
	const out: string[] = [];
	for (const m of sheet.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
		const selectors = m[1].split(",").map((x) => x.trim());
		if (selectors.some((x) => x.endsWith(sel))) out.push(m[2]);
	}
	return out.join(";");
}

function mountWith(doc: string) {
	const parent = document.createElement("div");
	document.body.append(parent);
	const view = new EditorView({ parent, state: EditorState.create({ doc, extensions: [atlasTheme] }) });
	return { view, parent };
}

test("the editor fills its host box (width and height 100%), not the width of its content", () => {
	const { view, parent } = mountWith("short");
	// The editor root is the `&` rule: its selector is the scope class alone.
	const root = [...css().matchAll(/(^|\})\s*(\.[^\s{,>]+)\s*\{([^}]*)\}/g)].map((m) => m[3]).join(";");
	expect(root).toMatch(/width:\s*100%/);
	expect(root).toMatch(/height:\s*100%/);
	// Not taken out of flow: CodeMirror's base rule keeps `position: relative !important` anyway.
	expect(root).not.toMatch(/position:\s*absolute/);
	view.destroy();
	parent.remove();
});

test("the scroller is the only scroll container and contains overscroll", () => {
	const { view, parent } = mountWith("x");
	const scroller = rule(css(), ".cm-scroller");
	expect(scroller).toMatch(/overflow:\s*auto/);
	expect(scroller).toMatch(/overscroll-behavior:\s*contain/);
	view.destroy();
	parent.remove();
});

test("content fills the pane width and the gutter stays put while scrolling sideways", () => {
	const { view, parent } = mountWith("y");
	const sheet = css();
	expect(rule(sheet, ".cm-content")).toMatch(/min-width:\s*100%/);
	const gutters = rule(sheet, ".cm-gutters");
	expect(gutters).toMatch(/position:\s*sticky/);
	expect(gutters).toMatch(/left:\s*0/);
	// Opaque, or scrolled text shows through the line numbers.
	expect(gutters).not.toMatch(/background-color:\s*transparent/);
	view.destroy();
	parent.remove();
});

test("a 5 MB single-line document mounts without sizing the host", () => {
	const { view, parent } = mountWith("a".repeat(5_000_000));
	// The wrapper never gets an inline width/height from the document length.
	expect(parent.style.width).toBe("");
	expect(parent.style.height).toBe("");
	expect(view.dom.style.width).toBe("");
	view.destroy();
	parent.remove();
});
