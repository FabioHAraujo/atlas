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
import { neighbour } from "#lib/shell/space.ts";
import { ws } from "#lib/stores/workspace.svelte.ts";
import type { GestureView } from "#lib/shell/gesture.ts";
import type { SwipeOptions } from "#lib/shell/swipe.ts";
import { spacePager } from "#lib/shell/pager.ts";

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

/** Space switching: two-finger swipe over the sidebar. */
export function spaceSwipe(): SwipeOptions {
	return {
		commitFrac: 0.3,
		can: (d) => neighbour(shell.spaceIds, shell.activeId, d) !== null,
		// DOM wheel path: finger travel in px over the sidebar maps 1:1 to the pager (`amount` = fraction
		// of a page, +1 = next). The recognizer decides the release (`onEnd`); the pager springs from there.
		onView: (v) => {
			if (v.phase !== "idle") spacePager.track(-v.offset / (content()?.clientWidth || 1));
			hintAccent(v.phase === "idle" ? 0 : v.dir);
		},
		onEnd: (end) => spacePager.settle(end.kind === "commit" ? end.dir : 0),
		// Native path: AppKit's amount (incl. its settle frames) drives the pager; `settle(dir)` is the
		// decision and the pager commits the switch itself. `track(0)` after tracking is a cancel.
		native: {
			zone: "space",
			onUpdate: (u) => {
				spacePager.track(u.amount);
				hintAccent(u.complete || u.amount === 0 ? 0 : u.amount > 0 ? 1 : -1);
			},
			onCommit: (c) => spacePager.settle(c.dir),
		},
	};
}

/** Groups whose native tab swipe committed: the remaining settle frames are not drawn (cleared when the tracker completes). */
const swallowed = new Set<string>();

/**
 * Two-page tab drag: the active pane and the tab it would land on move together, 1:1 with the
 * fingers (`amount` = fraction of a page, +1 = next). The neighbour is shown (`visibility`) only
 * while it moves; panes are laid out at full size even when hidden. A neighbour that was never
 * mounted (lazy tabs) simply is not there: the current pane slides over the empty body.
 */
function dragTabs(
	group: HTMLElement,
	order: string[],
	active: string | undefined,
	amount: number,
	rest: boolean,
) {
	const body = group.querySelector<HTMLElement>(":scope > .body");
	const strip = group.querySelector<HTMLElement>(":scope > .strip");
	if (!body || !strip) return;
	const w = body.clientWidth;
	const i = order.indexOf(active ?? "");
	const next = order[i + (amount > 0 ? 1 : -1)];
	for (const pane of body.querySelectorAll<HTMLElement>(":scope > .pane")) {
		const id = pane.dataset.tab;
		const x = id === active ? -amount * w : id === next ? (Math.sign(amount) - amount) * w : 0;
		pane.style.transform = rest || !x ? "" : `translate3d(${x}px,0,0)`;
		pane.style.visibility = !rest && id === next ? "visible" : "";
	}
	strip.style.transform = rest ? "" : `translate3d(${-amount * 24}px,0,0)`;
}

/** Tab switching: two-finger swipe over a tab strip. `ids` are the group's tabs in order. */
export function tabSwipe(
	groupId: string,
	group: () => HTMLElement | null,
	ids: () => string[],
	active: () => string | undefined,
): SwipeOptions {
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
		// Native path: the zone is the whole group (strip and pane), so it works over the content and
		// on overflowing strips; the pane follows the fingers and the strip nudges with it.
		native: {
			zone: "tab",
			id: groupId,
			el: group,
			onUpdate: (u) => {
				const el = group();
				if (!el) return;
				// After the commit the new tab is already active: AppKit's remaining settle frames
				// (amount → ±1) must not slide it again.
				const rest = swallowed.has(groupId) || u.complete;
				if (u.complete) swallowed.delete(groupId);
				dragTabs(el, ids(), active(), u.amount, rest);
			},
			onCommit: (c) => {
				swallowed.add(groupId);
				const id = target(c.dir);
				if (id) ws.activate(id);
			},
		},
	};
}

/** Back / Forward: swipe over the content where nothing can scroll horizontally (Safari's gesture). */
export function historySwipe(): SwipeOptions {
	return {
		commitFrac: 0.22,
		respectScrollers: true,
		can: (d) => shell.canGo(d),
		onView: (v) => mirror(v, 72),
		onEnd: (end) => end.kind === "commit" && shell.go(end.dir),
	};
}
