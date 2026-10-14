// @ts-nocheck bun test runtime types are not part of the app tsconfig
/**
 * Incident (user, 2026-10-13): the "Enable omp integration" card sat on top of the "Getting started" card. Seven
 * independent `position: fixed` pieces each hard-coded their own `right`/`bottom` in the bottom-right corner. They now
 * live in one stack: each takes the space above the previous one, so none can overlap whatever its height.
 */
import { describe, expect, test } from "bun:test";
import { CORNER_GAP, CORNER_ID, CORNER_MARGIN, layoutCorner } from "./cornerStack.ts";

const boxes = (placed) => placed.map((p) => [p.bottom, p.bottom + p.height]);
const overlaps = (a, b) => a[0] < b[1] && b[0] < a[1];

describe("layoutCorner stacks bottom-right pieces without overlap", () => {
	test("the first piece sits on the margin, the next one above it with the gap", () => {
		const out = layoutCorner([
			{ id: "checklist", height: 320 },
			{ id: "omp", height: 95 },
		]);
		expect(out[0]).toEqual({ id: "checklist", bottom: CORNER_MARGIN, height: 320 });
		expect(out[1]).toEqual({ id: "omp", bottom: CORNER_MARGIN + 320 + CORNER_GAP, height: 95 });
	});

	// Incident: omp card (y 575-670) over the open checklist (≈ 62-390 from the bottom).
	test("the omp card and the open checklist never overlap, for any heights", () => {
		for (const checklist of [34, 120, 320, 410])
			for (const omp of [60, 95, 160]) {
				const [a, b] = boxes(
					layoutCorner([
						{ id: "checklist", height: checklist },
						{ id: "omp", height: omp },
					]),
				);
				expect(overlaps(a, b)).toBe(false);
			}
	});

	test("a piece that is not showing (height 0) takes no room and leaves no gap", () => {
		const out = layoutCorner([
			{ id: "a", height: 0 },
			{ id: "b", height: 50 },
			{ id: "c", height: 0 },
			{ id: "d", height: 40 },
		]);
		expect(out.map((p) => p.id)).toEqual(["b", "d"]);
		expect(out[0].bottom).toBe(CORNER_MARGIN);
		expect(out[1].bottom).toBe(CORNER_MARGIN + 50 + CORNER_GAP);
	});

	test("an empty corner places nothing, and heights are never negative or NaN", () => {
		expect(layoutCorner([])).toEqual([]);
		expect(
			layoutCorner([
				{ id: "x", height: Number.NaN },
				{ id: "y", height: -4 },
			]),
		).toEqual([]);
	});

	test("order is the priority: the first id is nearest the corner", () => {
		const out = layoutCorner([
			{ id: "toast", height: 48 },
			{ id: "card", height: 100 },
		]);
		expect(out[0].id).toBe("toast");
		expect(out[0].bottom).toBeLessThan(out[1].bottom);
	});
});

describe("the corner is one container, not seven fixed boxes", () => {
	const { readFileSync } = require("node:fs");
	const { join } = require("node:path");
	const src = (p) => readFileSync(join(import.meta.dir, "../../", p), "utf8");
	// Every piece that used to anchor itself at the bottom-right corner (`position: fixed` + `right` + `bottom`).
	const PIECES = [
		"lib/onboarding/Checklist.svelte",
		"routes/(app)/SpaceView.svelte",
		"lib/settings/theme/GhosttyOffer.svelte",
		"lib/components/UpdatedCard.svelte",
		"lib/errors/ErrorToasts.svelte",
		"lib/panel/ActionResultToast.svelte",
	];
	for (const p of PIECES)
		test(`${p} mounts in the corner stack instead of anchoring itself`, () => {
			const s = src(p);
			expect(s).toContain("use:corner");
			expect(s).not.toMatch(/position:\s*fixed[^}]*\bbottom:/);
		});

	test("the corner action moves a node into #atlas-corner and takes it out again", async () => {
		const { corner, CORNER_ID } = await import("./cornerStack.ts");
		document.body.innerHTML = `<div id="${CORNER_ID}"></div><section id="home"><p id="p">x</p></section>`;
		const node = document.getElementById("p");
		const act = corner(node);
		expect(node.parentElement.id).toBe(CORNER_ID);
		act.destroy();
		expect(document.getElementById("p")).toBeNull();
	});

	test("without a corner (tray page) the node stays where it is", async () => {
		const { corner } = await import("./cornerStack.ts");
		document.body.innerHTML = `<section id="home"><p id="p">x</p></section>`;
		const node = document.getElementById("p");
		expect(corner(node)).toBeUndefined();
		expect(node.parentElement.id).toBe("home");
	});

	test("the shell mounts the corner column once, fixed bottom-right, with the margin and gap of layoutCorner", () => {
		const s = src("lib/shell/CornerStack.svelte");
		expect(s).toContain("id={CORNER_ID}");
		expect(CORNER_ID).toBe("atlas-corner");
		expect(s).toMatch(/position:\s*fixed/);
		expect(s).toContain("var(--corner-margin)");
		expect(s).toContain("var(--corner-gap)");
		expect(src("routes/(app)/+layout.svelte")).toContain("<CornerStack");
	});
});
