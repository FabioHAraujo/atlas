import { expect, test } from "bun:test";
import { ACTIONS, INTRO_TIMING, testId } from "../../apps/desktop/src/lib/onboarding/flow.ts";
import { parseRecipeV1 } from "../src/run/recipe.ts";
import recipe, { INTRO_MS } from "./onboarding.ts";

// This file is excluded from studio's tsc (it imports the app's source); bun runs it.
test("the recipe's timing and selectors are the welcome screen's own, not stale copies", () => {
	expect(INTRO_MS).toBe(INTRO_TIMING.durationMs);
	expect(INTRO_TIMING.hitMs).toBe(1680);
	const selectors = parseRecipeV1(recipe).captures[0]!.script.steps.flatMap((s) => ("selector" in s && s.selector ? [s.selector] : []));
	expect(selectors).toContain(`[data-testid="${ACTIONS.scan}"]`);
	for (const phase of ["welcome", "empty"]) expect(selectors).toContain(`[data-testid="${testId(phase)}"]`);
	expect(selectors).toContain('[data-intro="done"]');
});

test("no input before the title sequence is over: any key or click would skip it", () => {
	const steps = parseRecipeV1(recipe).captures[0]!.script.steps;
	const doneAt = steps.findIndex((s) => s.do === "wait" && s.selector === '[data-intro="done"]');
	expect(doneAt).toBeGreaterThanOrEqual(0);
	const input = new Set(["click", "type", "key", "run", "pointer", "scroll"]);
	expect(steps.slice(0, doneAt).filter((s) => input.has(s.do))).toEqual([]);
});

test("the app starts empty with onboarding on, so nothing of this Mac can appear", () => {
	expect(parseRecipeV1(recipe).captures[0]!.instance).toEqual({ projects: false, onboarding: true });
});
