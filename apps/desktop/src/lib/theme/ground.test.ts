// @ts-nocheck bun test runtime types are not part of the app tsconfig
/**
 * Incident (user, Atlas Dark, 2026-10-13): "a white gutter frames the main panel and the window edges, and the sidebar
 * looks light grey". The window is transparent over a native `NSVisualEffectView`; `html`/`body` were transparent and the
 * sidebar let 18% of that material through, so the ground of a DARK theme was whatever the material composited over the
 * wallpaper (measured `(255,255,255)` in the gutter on a bright one). The ground must belong to the theme.
 */
import { describe, expect, test } from "bun:test";
import atlas from "../themes/atlas.json";
import dracula from "../themes/dracula.json";
import one from "../themes/one.json";
import { luminance } from "./color.ts";
import { SIDEBAR_SEE_THROUGH, complete } from "./derive.ts";
import { nativeAppearance, sidebarWash, windowGround } from "./ground.ts";
import { parseFamily } from "./schema.ts";

const themes = [atlas, dracula, one].flatMap((f) => parseFamily(f).themes);
const done = (t) => complete(t.style, t.appearance);

describe("the window ground is the theme's own, opaque colour", () => {
	for (const t of themes) {
		test(`${t.name} (${t.appearance}): the ground is the theme's chrome surface, fully opaque, on the right side of mid-grey`, () => {
			const s = done(t);
			const g = windowGround(s);
			expect(g).toBe(s.background.slice(0, 7).toLowerCase());
			expect(g).toMatch(/^#[0-9a-f]{6}$/);
			const l = luminance(g);
			if (t.appearance === "dark") expect(l).toBeLessThan(0.1);
			else expect(l).toBeGreaterThan(0.5);
		});
	}

	// The incident in one line: a dark theme's ground must not be white-ish whatever the wallpaper is.
	test("Atlas Dark's ground is the bottom rung of its blue ladder, darker than the editor and the raised surface", () => {
		const s = done(themes.find((t) => t.name === "Atlas Dark"));
		const g = luminance(windowGround(s));
		expect(g).toBeLessThan(luminance(s["editor.background"]));
		expect(luminance(s["editor.background"])).toBeLessThan(luminance(s["surface.background"]));
		expect(luminance(s["surface.background"])).toBeLessThan(luminance(s["elevated_surface.background"]));
	});
});

describe("the sidebar no longer lets the native material through", () => {
	// Incident: 18% of a white-ish material over a dark sidebar read as "light grey".
	test("see-through is 0 and the wash is the theme's ground at full strength", () => {
		expect(SIDEBAR_SEE_THROUGH).toBe(0);
		expect(sidebarWash()).toBe("var(--ca-surface-sunken)");
	});
});

describe("the native window appearance follows the RESOLVED theme, not the preference", () => {
	// Incident: `mode: system` (the default) pinned the window to `null` = "follow macOS", so the material could render
	// light under Atlas Dark (or dark under Atlas Light) whenever the two disagreed, e.g. a theme pinned per mode.
	test("a resolved dark theme pins dark, a light one pins light, whatever the preference", () => {
		for (const pref of ["system", "dark", "light"]) {
			expect(nativeAppearance(pref, "dark")).toBe("dark");
			expect(nativeAppearance(pref, "light")).toBe("light");
		}
	});
	test("before a theme resolves, the preference decides (system = follow macOS)", () => {
		expect(nativeAppearance("system", undefined)).toBeNull();
		expect(nativeAppearance("dark", undefined)).toBe("dark");
		expect(nativeAppearance("light", undefined)).toBe("light");
	});
});
