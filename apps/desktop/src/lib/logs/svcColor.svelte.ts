/** The theme-aware colour of a service's name in the logs (see `serviceColor`): re-evaluated when the theme changes. */
import { themes } from "#lib/stores/theme.svelte.ts";
import { hue, serviceColor } from "./text.ts";

const SURFACES = ["background", "editor.background", "surface.background", "elevated_surface.background"];

export function svcColor(name: string): string {
	const s = themes.current?.style;
	return serviceColor(hue(name), s ? SURFACES.map((k) => String(s[k])) : ["#000000"]);
}
