// @ts-nocheck bun test runtime types are not part of the app tsconfig
import "../../../test/setup.ts";
import { expect, test } from "bun:test";

// Dynamic on purpose: the Svelte loader registered by test/setup.ts must exist before the component loads.
const { flushSync, mount, unmount } = await import("svelte");
const { default: StatusBar } = await import("./StatusBar.svelte");

const input = (over = {}) => ({
	line: 12,
	col: 5,
	selections: { count: 1, chars: 0, lines: 1 },
	indent: { style: "space", size: 2, detected: true },
	eol: "lf",
	encoding: "utf-8",
	language: { id: "typescript", label: "TypeScript" },
	problems: { errors: 0, warnings: 0 },
	tier: "normal",
	wrap: false,
	...over,
});

function render(props) {
	const target = document.createElement("div");
	document.body.append(target);
	const app = flushSync(() => mount(StatusBar, { target, props }));
	return { target, done: () => unmount(app) };
}

test("renders the compact items in VS Code wording", () => {
	const { target, done } = render({ input: input(), onaction: () => {} });
	const text = target.textContent.replace(/\s+/g, " ");
	for (const want of ["Ln 12, Col 5", "Spaces: 2", "UTF-8", "LF", "TypeScript"]) expect(text).toContain(want);
	done();
});

test("clicking an action item reports its id; plain items are not buttons", () => {
	const seen = [];
	const { target, done } = render({ input: input(), onaction: (id) => seen.push(id) });
	const buttons = [...target.querySelectorAll("button")];
	buttons.find((b) => b.textContent.includes("Spaces")).click();
	buttons.find((b) => b.textContent.includes("Ln 12")).click();
	buttons.find((b) => b.textContent === "LF").click();
	expect(seen).toEqual(["indent", "position", "eol"]);
	expect(buttons.some((b) => b.textContent === "UTF-8")).toBe(false);
	done();
});

test("problems and a large-file tier show as warnings; mixed endings are flagged", () => {
	const { target, done } = render({
		input: input({ problems: { errors: 2, warnings: 1 }, tier: "large", eol: "mixed" }),
		onaction: () => {},
	});
	const text = target.textContent;
	expect(text).toContain("2 errors, 1 warning");
	expect(text).toContain("Large file");
	expect(text).toContain("Mixed");
	expect(target.querySelector(".error")?.textContent).toContain("2 errors");
	done();
});

test("a selection count and size show next to the position", () => {
	const { target, done } = render({
		input: input({ selections: { count: 3, chars: 24, lines: 2 } }),
		onaction: () => {},
	});
	expect(target.textContent).toContain("Ln 12, Col 5 (3 selections) (24 selected)");
	done();
});
