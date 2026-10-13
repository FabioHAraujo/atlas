/**
 * Aims a trace at the zone it is meant for. The synthesized traces say *what the pointer is over* ("sidebar",
 * "strip", …), not where that is on this window's layout, which varies (a hidden sidebar, a resized window). The
 * bench reads the zones the app actually pushed to the engine and rewrites each sample's pointer to a point in
 * the right one, so the engine is exercised through its real hit-test instead of through assumed coordinates.
 */
import type { ScrollSample } from "#lib/shell/trace.ts";

export interface LiveZone {
	zone: "space" | "tab" | "history";
	id?: string;
	rect: { x: number; y: number; w: number; h: number };
	prev: boolean;
	next: boolean;
	pinned: boolean;
}

export type Aim = "sidebar" | "strip" | "history" | "outside";

const mid = (r: LiveZone["rect"]) => ({ x: Math.round(r.x + r.w / 2), y: Math.round(r.y + r.h / 2) });

/** A point inside `zone` but outside every zone nested deeper (later in the list = deeper wins natively). */
function pointIn(target: LiveZone, deeper: LiveZone[]): { x: number; y: number } | null {
	const r = target.rect;
	const step = 24;
	for (let y = r.y + 4; y < r.y + r.h; y += step)
		for (let x = r.x + step; x < r.x + r.w; x += step)
			if (
				!deeper.some(
					(d) => x >= d.rect.x && x < d.rect.x + d.rect.w && y >= d.rect.y && y < d.rect.y + d.rect.h,
				)
			)
				return { x: Math.round(x), y: Math.round(y) };
	return null;
}

/** The trace with every pointer moved into the aimed zone; null when the layout has no such zone. */
export function aim(events: ScrollSample[], at: Aim, zones: LiveZone[]): ScrollSample[] | null {
	let p: { x: number; y: number } | null = null;
	if (at === "sidebar") {
		const z = zones.find((x) => x.zone === "space");
		p = z ? mid(z.rect) : null;
	} else if (at === "strip") {
		const z = zones.find((x) => x.zone === "tab");
		// the strip is the group's top band; the zone is the whole group, so aim just inside its top edge
		p = z ? { x: Math.round(z.rect.x + z.rect.w / 2), y: Math.round(z.rect.y + 12) } : null;
	} else if (at === "history") {
		const h = zones.find((x) => x.zone === "history");
		const deeper = zones.filter((x) => x !== h);
		p = h ? pointIn(h, deeper) : null;
	} else {
		const top = Math.min(...zones.map((z) => z.rect.y));
		p = { x: 400, y: Math.max(0, top - 4) };
	}
	return p ? events.map((e) => ({ ...e, x: p.x, y: p.y })) : null;
}
