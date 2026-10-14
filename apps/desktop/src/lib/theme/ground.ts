/**
 * The window ground. The Tauri window is transparent over a native `NSVisualEffectView`; whatever the page leaves
 * transparent shows that material, whose brightness is the wallpaper's and macOS's, never the theme's. A dark theme
 * must not frame its panels in white, so the page owns the ground: the theme's chrome `background` (the bottom rung of
 * its surface ladder), opaque, under the sidebar and the gutter around `.content`.
 */
import { color, opaque } from "./color.ts";
import type { ThemeStyle } from "./schema.ts";

/** What the ground paints in CSS: every theme sets `--ca-surface-sunken` from its `background`. */
export const GROUND_VAR = "var(--ca-surface-sunken)";

/** The ground as a hex colour (alpha dropped: the ground is never see-through). */
export const windowGround = (s: ThemeStyle): string => opaque(color(s.background)!);

/** The sidebar's background: the ground itself, no native material mixed in. */
export const sidebarWash = (): string => GROUND_VAR;

export type NativeAppearance = "dark" | "light" | null;

/**
 * The appearance to pin the native window (and so its material) to: the RESOLVED theme's, so a dark theme is never
 * drawn over a light material (or the reverse) whatever the preference says. Without a theme yet, the preference
 * decides; `null` = follow macOS.
 */
export function nativeAppearance(
	preference: "system" | "dark" | "light",
	resolved: "dark" | "light" | undefined,
): NativeAppearance {
	if (resolved) return resolved;
	return preference === "system" ? null : preference;
}
