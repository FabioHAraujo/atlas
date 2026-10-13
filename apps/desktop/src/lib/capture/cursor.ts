/**
 * The pointer drawn into recordings. ScreenCaptureKit can only show the real OS cursor, which a script never moves
 * (it sends no OS input), so the pointer is an element inside the page, driven by the script's `click`/`pointer` steps.
 * It is `pointer-events: none` and above everything, and is removed when the script ends.
 */

import { cursorPath, type Point } from "./motion.ts";
import type { CursorOverlay, CursorSampler } from "./runner.ts";

const ID = "__atlas_capture_cursor";
const FRAME_MS = 16;
/** A 24 px arrow with a white outline and a soft shadow, hotspot at its tip. */
const ARROW = `<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M3 2l15 9.5-6.4 1.6 3.7 6.9-2.8 1.5-3.7-7-4.8 4.5z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>`;

export function createCursor(now: () => number = Date.now): CursorOverlay {
	let el: HTMLElement | undefined;
	let at: Point = { x: 40, y: 40 };
	const place = (p: Point) => {
		at = p;
		if (el) el.style.transform = `translate(${p.x}px, ${p.y}px)`;
	};
	return {
		show() {
			el?.remove();
			el = document.createElement("div");
			el.id = ID;
			el.innerHTML = ARROW;
			el.style.cssText =
				"position:fixed;left:0;top:0;width:24px;height:24px;margin:-2px 0 0 -3px;z-index:2147483647;pointer-events:none;filter:drop-shadow(0 2px 3px rgba(0,0,0,.35));will-change:transform";
			document.body.append(el);
			place(at);
		},
		hide() {
			el?.remove();
			el = undefined;
		},
		async moveTo(p: Point, ms: number, sample: CursorSampler) {
			const steps = Math.max(1, Math.round(ms / FRAME_MS));
			const path = cursorPath(at, p, steps);
			const t0 = now();
			let last = -1;
			const { promise, resolve } = Promise.withResolvers<void>();
			const id = setInterval(() => {
				const i = Math.min(steps, Math.floor((now() - t0) / FRAME_MS));
				if (i !== last) {
					last = i;
					const q = path[i]!;
					place(q);
					sample(now(), q.x, q.y);
				}
				if (i >= steps) {
					clearInterval(id);
					resolve();
				}
			}, FRAME_MS / 2);
			await promise;
		},
	};
}
