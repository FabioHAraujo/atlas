/**
 * App-level trackpad gestures (Arc), built on `swipe()`:
 *
 *  - space:    two-finger swipe over the sidebar → previous / next space. The content follows
 *              the finger (rubber-banded) and the next space's accent shows as an edge hint.
 *  - tabs:     swipe over the tab strip → previous / next tab (lighter travel).
 *  - history:  swipe over the content where nothing can scroll → Back / Forward, with an arrow
 *              chip that fills as you drag.
 *
 * Live values are written inline (`transform` on the moving elements, `--hint-accent` on the
 * edge hint); nothing here touches Svelte state until a gesture commits.
 */
import { shell } from "#lib/shell/shell.svelte.ts";
import { edgeNeighbour, neighbour } from "#lib/shell/space.ts";
import { ws } from "#lib/stores/workspace.svelte.ts";
import { historyView, type GestureView } from "#lib/shell/gesture.ts";
import type { SwipeOptions } from "#lib/shell/swipe.ts";
import { spacePager } from "#lib/shell/pager.ts";
import { tabPager, type TabHost } from "#lib/shell/tabPager.ts";

const content = () => document.querySelector<HTMLElement>("main.content");

/**
 * Mirror the Back/Forward view. Per event only `transform` (and the chip fill) is written, straight
 * on the elements that move: a transform is compositor-only, while a custom property on the content
 * root would restyle every descendant (logs, editors, the panel) on each wheel event. The root's
 * `data-nav` attribute, which switches the CSS to tracking mode, changes only with the direction.
 */
function mirror(v: GestureView, maxPx: number) {
	const el = content();
	if (!el) return;
	const view = el.querySelector<HTMLElement>(".space-view");
	const chips = el.querySelectorAll<HTMLElement>(".nav-chip");
	if (v.phase === "idle") {
		if (el.dataset.nav !== undefined) delete el.dataset.nav;
		if (view) view.style.transform = "";
		for (const c of chips) ((c.style.transform = ""), (c.style.background = ""));
		return;
	}
	const state = v.dir > 0 ? "next" : v.dir < 0 ? "prev" : "";
	if (el.dataset.nav !== state) el.dataset.nav = state;
	const x = Math.max(-maxPx, Math.min(maxPx, v.offset));
	if (view) view.style.transform = `translate3d(${x * 0.35}px,0,0)`;
	for (const c of chips) {
		const nudge = c.classList.contains("nav-chip-prev") ? -4 : 4;
		c.style.transform = `translate3d(${x * 0.5 + nudge}px,0,0)`;
		c.style.background = `color-mix(in oklab, var(--space-accent) ${Math.round(v.progress * 70)}%, var(--ca-surface-raised))`;
	}
}

/** Accent of the space a swipe would land on; shown as an edge hint while dragging. */
let hintDir: 1 | -1 | 0 = 0;
function hintAccent(dir: 1 | -1 | 0) {
	if (dir === hintDir) return; // only on a direction change, not per frame
	hintDir = dir;
	const el = content();
	if (!el) return;
	const to = dir ? neighbour(shell.spaceIds, shell.activeId, dir) : null;
	const edge = el.querySelector<HTMLElement>(".space-edge") ?? el;
	if (to) edge.style.setProperty("--hint-accent", shell.accent(to));
	else edge.style.removeProperty("--hint-accent");
}

/** Generation counter of the DOM-wheel fallback (the native engine stamps its own). */
let wheelSeq = 0;

/** Space switching: two-finger swipe over the sidebar. */
export function spaceSwipe(): SwipeOptions {
	return {
		commitFrac: 0.3,
		// no wrap: past the first or last space a swipe only stretches
		can: (d) => edgeNeighbour(shell.spaceIds, shell.activeId, d) !== null,
		// DOM wheel path (platforms without the native engine): finger travel over the sidebar follows the
		// pager 1:1 (`amount` = fraction of a page, +1 = next) as frames of a local generation; the recognizer's
		// release is the decision and the switch lands without a settle animation (no second physics here).
		onView: (v) => {
			if (v.phase !== "idle")
				spacePager.frame({
					zone: "space",
					seq: wheelSeq + 1,
					amount: -v.offset / (content()?.clientWidth || 1),
					stage: "track",
				});
			hintAccent(v.phase === "idle" ? 0 : v.dir);
		},
		onEnd: (end) => {
			const seq = ++wheelSeq;
			spacePager.commit({ zone: "space", seq, dir: end.kind === "commit" ? end.dir : 0 });
			spacePager.frame({ zone: "space", seq, amount: 0, stage: "rest" });
		},
		// Native path: the engine's frames and one decision per generation drive the pager.
		native: {
			zone: "space",
			onFrame: (f) => {
				spacePager.frame(f);
				hintAccent(f.stage === "rest" || f.amount === 0 ? 0 : f.amount > 0 ? 1 : -1);
			},
			onCommit: (c) => spacePager.commit(c),
		},
	};
}

/** Tab switching: two-finger swipe over a tab strip. `ids` are the group's tabs in order. */
export function tabSwipe(
	groupId: string,
	group: () => HTMLElement | null,
	ids: () => string[],
	active: () => string | undefined,
): SwipeOptions {
	const activate = (id: string) => ws.activate(id);
	const target = (d: 1 | -1) => {
		const all = ids();
		const i = all.indexOf(active() ?? "");
		return i < 0 ? undefined : all[i + d];
	};
	return {
		commitFrac: 0.18,
		respectScrollers: true,
		flickSpeed: 0.7,
		can: (d) => target(d) !== undefined,
		onView: (v, el) => {
			// The strip nudges with the fingers; nothing else moves.
			el.style.transform =
				v.phase === "idle" ? "" : `translate3d(${Math.max(-48, Math.min(48, v.offset * 0.25))}px,0,0)`;
		},
		onEnd: (end) => {
			const id = end.kind === "commit" ? target(end.dir) : undefined;
			if (id) ws.activate(id);
		},
		// Native path: the zone is the whole group (strip and pane), so it works over the content and on
		// overflowing strips; the engine's frames move the active pane and the tab it lands on together.
		native: {
			zone: "tab",
			id: groupId,
			el: group,
			onFrame: (f) => {
				const body = bodyHost(group, ids, active, activate);
				if (body) tabPager.frame(groupId, body, f);
			},
			onCommit: (c) => {
				const body = bodyHost(group, ids, active, activate);
				if (body) tabPager.commit(groupId, body, c);
			},
		},
	};
}

/** The tab pager's view of a group element: its body and strip, the order and the activation. */
function bodyHost(
	group: () => HTMLElement | null,
	ids: () => string[],
	active: () => string | undefined,
	activate: (id: string) => void,
): TabHost | null {
	const el = group();
	const body = el?.querySelector<HTMLElement>(":scope > .body");
	if (!el || !body) return null;
	return {
		pane: (id) =>
			body.querySelector<HTMLElement>(`:scope > .pane[data-tab="${CSS.escape(id)}"]`) ?? undefined,
		strip: () => el.querySelector<HTMLElement>(":scope > .strip"),
		width: () => body.clientWidth,
		order: ids,
		active,
		activate,
	};
}

/** Highest history generation already applied (a duplicate decision must not step twice). */
let historyApplied = 0;

/** Back / Forward: swipe over the content where nothing can scroll horizontally (Safari's gesture). */
export function historySwipe(): SwipeOptions {
	return {
		commitFrac: 0.22,
		respectScrollers: true,
		can: (d) => shell.canGo(d),
		onView: (v) => mirror(v, 72),
		onEnd: (end) => end.kind === "commit" && shell.go(end.dir),
		// Native path: the engine's frames draw the same nudge and chip fill; its decision (once per generation)
		// steps the history. Zones where something scrolls horizontally are excluded natively.
		native: {
			zone: "history",
			onFrame: (f) => {
				mirror(historyView(f, content()?.clientWidth || 1), 72);
			},
			onCommit: (c) => {
				if (c.dir !== 0 && c.seq > historyApplied) {
					historyApplied = c.seq;
					shell.go(c.dir > 0 ? 1 : -1);
				}
			},
		},
	};
}
