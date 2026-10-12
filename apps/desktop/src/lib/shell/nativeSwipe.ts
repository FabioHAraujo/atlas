/**
 * Frontend half of the native trackpad swipe (`crates/atlas-desktop/src/swipe_mac.rs`).
 *
 * AppKit recognizes the gesture before the webview sees it, tracks it (1:1 amount, rubber band,
 * velocity decision, settle animation) and reports it over two events:
 *  - `swipe://update`  every tracker callback: `{ zone, id?, amount, phase, complete }`
 *  - `swipe://commit`  once when the fingers lifted on a switch: `{ zone, id?, dir }`
 * This module pushes the zone rects the native side hit-tests (`swipe_zones`) and dispatches
 * the events to the handler registered for that zone. Handlers only write transforms.
 *
 * When native tracking is unavailable (not macOS, or "Swipe between pages" is off in System
 * Settings) `nativeActive()` stays false and `swipe.ts` keeps its DOM wheel recognizer.
 */
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type SwipeZone = "space" | "tab" | "history";

export interface SwipeUpdate {
	zone: SwipeZone;
	id?: string;
	/** AppKit gestureAmount: 0 = rest, +1 = one full page toward next. May rubber-band past ±1. */
	amount: number;
	phase: "began" | "changed" | "ended" | "cancelled";
	complete: boolean;
}

export interface SwipeCommit {
	zone: SwipeZone;
	id?: string;
	dir: 1 | -1;
}

export interface NativeSwipe {
	zone: SwipeZone;
	id?: string;
	/** Whether a neighbour exists in that direction: bounds the tracked amount natively. */
	can: (dir: 1 | -1) => boolean;
	/** Zone-specific: only count the zone when this is true (history: nothing scrolls under the pointer). */
	pinned?: () => boolean;
	/** `amount` while tracking, including AppKit's settle frames. */
	onUpdate: (u: SwipeUpdate) => void;
	/** Fingers lifted on a switch. Called once, before the settle frames finish. */
	onCommit: (c: SwipeCommit) => void;
}

interface Entry {
	el: HTMLElement;
	spec: NativeSwipe;
}

let native = false;
let ready: Promise<void> | null = null;
const entries = new Set<Entry>();
let raf = 0;
let last = "";

/** Is the native recognizer driving swipes? Resolved once at startup by `initNativeSwipe`. */
export const nativeActive = () => native;

/** Decide once whether native tracking is on, and subscribe to its events. Idempotent. */
export function initNativeSwipe(): Promise<void> {
	ready ??= (async () => {
		if (!("__TAURI_INTERNALS__" in window)) return;
		try {
			native = await invoke<boolean>("swipe_native");
		} catch {
			native = false;
		}
		if (!native) return;
		await listen<SwipeUpdate>("swipe://update", (e) => {
			for (const x of entries) if (matches(x, e.payload)) x.spec.onUpdate(e.payload);
		});
		await listen<SwipeCommit>("swipe://commit", (e) => {
			for (const x of entries) if (matches(x, e.payload)) x.spec.onCommit(e.payload);
		});
		push();
	})();
	return ready;
}

const matches = (x: Entry, p: { zone: SwipeZone; id?: string }) =>
	x.spec.zone === p.zone && (x.spec.id ?? undefined) === (p.id ?? undefined);

/** Rect in CSS px clipped to the viewport, or null (hidden, `inert`, parked off-screen or empty). */
function rectOf(el: HTMLElement) {
	if (el.closest("[inert]")) return null;
	const r = el.getBoundingClientRect();
	const x = Math.max(0, r.x);
	const y = Math.max(0, r.y);
	const w = Math.min(innerWidth, r.right) - x;
	const h = Math.min(innerHeight, r.bottom) - y;
	return w < 1 || h < 1 ? null : { x, y, w, h };
}

/**
 * Push the zones now. Order matters natively (later = deeper wins): outer zones first. DOM order
 * of registration is not nesting order, so sort by area, largest first.
 */
function push() {
	raf = 0;
	if (!native) return;
	const zones = [];
	for (const { el, spec } of entries) {
		const rect = rectOf(el);
		if (!rect) continue;
		zones.push({
			zone: spec.zone,
			id: spec.id,
			rect,
			prev: spec.can(-1),
			next: spec.can(1),
			pinned: spec.pinned?.() ?? false,
		});
	}
	zones.sort((a, b) => b.rect.w * b.rect.h - a.rect.w * a.rect.h);
	const key = JSON.stringify(zones);
	if (key === last) return;
	last = key;
	void invoke("swipe_zones", { zones });
}

/** Coalesce pushes to one per frame. */
export function pushZones() {
	if (native && !raf) raf = requestAnimationFrame(push);
}

/**
 * Register an element as a native swipe zone. Returns a cleanup. Rects are re-pushed on resize
 * of the element or the window; call `pushZones()` when neighbour availability changes.
 */
export function registerZone(
	el: HTMLElement,
	spec: NativeSwipe,
): { update(s: NativeSwipe): void; destroy(): void } {
	const entry: Entry = { el, spec };
	entries.add(entry);
	const ro = new ResizeObserver(pushZones);
	ro.observe(el);
	addEventListener("resize", pushZones);
	pushZones();
	return {
		update(s) {
			entry.spec = s;
			pushZones();
		},
		destroy() {
			entries.delete(entry);
			ro.disconnect();
			removeEventListener("resize", pushZones);
			pushZones();
		},
	};
}
