/**
 * Space pager: the transform engine behind space switching (Arc's full-width pager).
 *
 * `SpacePager.svelte` mounts the current space plus its two neighbours as absolutely positioned
 * layers and registers them here by space id. This module only writes `transform` on those
 * layers (no Svelte state, no transitions); one commit per switch goes through `shell`.
 *
 *   amount  fraction of the content width the *current* layer has moved toward `dir`
 *           (+1 = next). The current layer sits at `-amount·W`, the neighbour in the direction of
 *           travel at `(dir - amount)·W`. Past ±1 the amount is rubber banded by the caller.
 *
 * Two drivers feed it:
 *   - tracking: `track(amount)` per frame (native AppKit callbacks or the DOM wheel recognizer);
 *     `settle(dir)` is the decision on release. If no `track()` follows, a critically damped spring
 *     (stiffness ~280) carries the layers from the current offset and release velocity to the
 *     target. If frames keep coming (AppKit animates the settle itself) they win.
 *   - `go(id)`: keyboard / click / history; same spring, short, from rest.
 *
 * The state commit (`shell.commitSpace`) happens when the switch is decided, not when the
 * animation ends, so keyboard consumers see the new selection at once. The layers then animate
 * in the roles they will have: after the swap the *new* current layer is the one that started as
 * the neighbour, so the animation continues from the same pixels.
 */

/** Spring: critically damped (`damping = 2·√stiffness`, mass 1). */
const STIFFNESS = 280;
const OMEGA = Math.sqrt(STIFFNESS);
/** Settled when closer than this (fraction of width) to the target and slower than `REST_V`. */
const REST_X = 0.0005;
const REST_V = 0.01;
/** Rubber-band resistance past the first/last page. */
const MAX_AMOUNT = 1.15;

export type Dir = 1 | -1;

export interface PagerHost {
	/** Layer elements keyed by space id (current + neighbours that are mounted). */
	layer(id: string): HTMLElement | undefined;
	/** Width of the pager viewport in CSS px. */
	width(): number;
	/** Space ids by sidebar order, and the active one. */
	ids(): string[];
	active(): string | null;
	/** Switch the selection to `id` right now (no animation of its own). */
	commit(id: string): void;
	/** Flip per-gesture state: natives parked, `keep` layers mounted and unhidden. Never called per frame. */
	moving(on: boolean, keep?: string[]): void;
	/** Resolves once Svelte has applied the pending state (after `commit`). */
	flush(): Promise<void>;
}

/** Fraction → clamped with a soft rubber band past ±1. */
export function rubber(amount: number): number {
	const a = Math.abs(amount);
	if (a <= 1) return amount;
	const over = a - 1;
	return Math.sign(amount) * Math.min(MAX_AMOUNT, 1 + over / (1 + over * 4));
}

/**
 * Critically damped spring, closed form (mass 1, `ω = √stiffness`): position at time `t` seconds of
 * a spring released at `x0` with velocity `v0` (per second) toward `to`.
 */
export function springAt(x0: number, v0: number, to: number, t: number): number {
	const d = x0 - to;
	return to + (d + (v0 + OMEGA * d) * t) * Math.exp(-OMEGA * t);
}

/** Seconds until the spring is within `REST_X` of `to` (and slow enough to stop). */
export function springDuration(x0: number, v0: number, to: number): number {
	for (let t = 0.05; t < 2; t += 0.01) {
		const v = (springAt(x0, v0, to, t + 0.005) - springAt(x0, v0, to, t - 0.005)) * 100;
		if (Math.abs(springAt(x0, v0, to, t) - to) < REST_X && Math.abs(v) < REST_V) return t;
	}
	return 2;
}

class Pager {
	#host: PagerHost | null = null;
	/** Layer that was current when the gesture began, the neighbour it heads to, and the heading. */
	#out: string | null = null;
	#inc: string | null = null;
	#dir: Dir = 1;
	#amount = 0;
	#velocity = 0;
	#lastT = 0;
	/** First `track()`/`go()` until the layers are back at rest. */
	#active = false;
	/** The selection already moved to `#inc` (release decided on a switch). */
	#committed = false;
	#raf = 0;
	#anims: Animation[] = [];
	/** Bumped when a gesture starts, so a `#finish` awaiting Svelte can tell it was superseded. */
	#gen = 0;
	#guard: ReturnType<typeof setTimeout> | undefined;
	/** Spring in flight, to read the live amount back if a new gesture interrupts it. */
	#spring: { x0: number; v0: number; to: number; lead: Animation } | null = null;
	/** Frames keep arriving after `settle()` (AppKit animates): the spring only starts if they do not. */
	#grace = 0;

	get active() {
		return this.#active;
	}

	attach(host: PagerHost) {
		this.#host = host;
		return () => {
			this.#end();
			this.#host = null;
		};
	}

	/**
	 * Follow the fingers: `amount` is AppKit's gestureAmount relative to the space that was
	 * current when the gesture began (+1 = a full width toward next). Called for every tracker
	 * callback, including its own settle frames; `track(0)` after tracking is "back at rest".
	 */
	track(amount: number) {
		const h = this.#host;
		if (!h) return;
		this.#stopSpring();
		if (!this.#active) {
			if (amount === 0 || !this.#begin(amount > 0 ? 1 : -1)) return;
		}
		const a = rubber(amount);
		const now = performance.now();
		if (this.#lastT) {
			const dt = (now - this.#lastT) / 1000;
			if (dt > 0) this.#velocity = this.#velocity * 0.5 + ((a - this.#amount) / dt) * 0.5;
		}
		this.#lastT = now;
		this.#amount = a;
		this.#write(a);
		// AppKit's settle frames end at the target: ±1 once committed, exactly 0 on a cancel.
		if (this.#committed ? Math.abs(a) >= 1 : a === 0) void this.#finish();
		else if (this.#grace) this.#armSpring();
	}

	/**
	 * The decision on release: `dir` 1 / -1 switches (the selection changes now, so keyboard
	 * consumers see it at once), 0 springs back. The layers go on from where the fingers left them.
	 */
	settle(dir: Dir | 0) {
		const h = this.#host;
		if (!h) return;
		if (!this.#active && (dir === 0 || !this.#begin(dir))) return;
		if (dir !== 0 && !this.#committed && this.#inc) {
			// The gesture heads to `dir`; a commit against it (tracking lost sync) restarts toward `dir`.
			if (dir !== this.#dir) this.#retarget(dir);
			this.#committed = true;
			h.commit(this.#inc!);
		}
		this.#grace = 1;
		this.#armSpring(dir);
	}

	/**
	 * Keyboard / click / history / ctl: switch to `id` with the pager animation, from rest.
	 * With `origin` the selection already moved (history picks its own worktree): only animate.
	 */
	go(id: string, origin?: string) {
		const h = this.#host;
		const from = origin ?? h?.active();
		if (!h || !from || from === id) return false;
		this.#end();
		const ids = h.ids();
		const dir: Dir = ids.indexOf(id) >= ids.indexOf(from) ? 1 : -1;
		if (!this.#begin(dir, id, from)) return false;
		this.#committed = true;
		if (!origin) h.commit(id);
		this.#grace = 0;
		this.#startSpring(dir);
		return true;
	}

	#neighbourOf(id: string, dir: Dir) {
		const ids = this.#host?.ids() ?? [];
		const i = ids.indexOf(id);
		return i < 0 || ids.length < 2 ? null : ids[(i + dir + ids.length) % ids.length];
	}

	#begin(dir: Dir, target?: string, origin?: string): boolean {
		const h = this.#host!;
		this.#stopSpring();
		this.#clear(); // leftovers of a gesture whose `#finish` was still waiting on Svelte
		const out = origin ?? h.active();
		const inc = target ?? (out ? this.#neighbourOf(out, dir) : null);
		if (!out || !inc || !h.layer(out) || !h.layer(inc)) return false;
		this.#out = out;
		this.#inc = inc;
		this.#dir = dir;
		this.#active = true;
		this.#gen++;
		this.#committed = false;
		this.#amount = 0;
		this.#velocity = 0;
		this.#lastT = 0;
		this.#grace = 0;
		h.moving(true, [out, inc]);
		return true;
	}

	#retarget(dir: Dir) {
		const h = this.#host!;
		this.#inc && h.layer(this.#inc)?.style.removeProperty("transform");
		this.#dir = dir;
		this.#inc = this.#out ? this.#neighbourOf(this.#out, dir) : null;
		h.moving(true, [this.#out ?? "", this.#inc ?? ""]);
	}

	/** `out` at -a·W, `inc` at (dir - a)·W: one transform write per layer, nothing else. */
	#write(a: number) {
		const h = this.#host!;
		const w = h.width();
		const o = h.layer(this.#out ?? "");
		const n = h.layer(this.#inc ?? "");
		if (o) o.style.transform = `translate3d(${-a * w}px,0,0)`;
		if (n) n.style.transform = `translate3d(${(this.#dir - a) * w}px,0,0)`;
	}

	/** After `settle()`: if AppKit sends no frame for a beat, take over with our own spring. */
	#armSpring(dir: Dir | 0 = this.#committed ? this.#dir : 0) {
		cancelAnimationFrame(this.#raf);
		const at = this.#lastT;
		// Two frames of silence = nobody is animating the settle.
		this.#raf = requestAnimationFrame(() => {
			this.#raf = requestAnimationFrame(() => {
				if (this.#active && this.#lastT === at) this.#startSpring(dir);
				else if (this.#active) this.#armSpring(dir);
			});
		});
	}

	/**
	 * Carry the layers to `dir` (or back to 0) from the current amount and release velocity. Each
	 * layer gets one Web Animations transform animation sampled from the exact spring, so a busy
	 * main thread (the commit's reactive fan-out) delays frames but never stretches the motion.
	 */
	#startSpring(dir: Dir | 0) {
		this.#stopSpring();
		const h = this.#host!;
		const to = dir === 0 ? 0 : dir;
		const x0 = this.#amount;
		let v0 = this.#velocity;
		if ((to - x0) * v0 < 0) v0 = 0; // never start the wrong way
		const sec = springDuration(x0, v0, to);
		const w = h.width();
		const frames = Math.max(2, Math.ceil(sec * 120));
		// The last keyframe is the exact target (the spring only gets within `REST_X` of it).
		const curve = (shift: number) =>
			Array.from({ length: frames + 1 }, (_, i) => ({
				transform: `translate3d(${(shift - (i === frames ? to : springAt(x0, v0, to, (sec * i) / frames))) * w}px,0,0)`,
			}));
		const play = (id: string | null, shift: number) => {
			const el = id ? h.layer(id) : undefined;
			return el?.animate(curve(shift), { duration: sec * 1000, easing: "linear", fill: "forwards" });
		};
		this.#anims = [play(this.#out, 0), play(this.#inc, this.#dir)].filter((a): a is Animation => !!a);
		const lead = this.#anims[0];
		if (!lead) return void this.#finish();
		this.#spring = { x0, v0, to, lead };
		this.#amount = to;
		const done = () => this.#active && this.#anims.includes(lead) && void this.#finish();
		void lead.finished.then(done, () => {});
		// Animations pause with a hidden/occluded window: the timer guarantees natives are never left parked.
		this.#guard = setTimeout(done, sec * 1000 + 250);
	}

	#stopSpring() {
		clearTimeout(this.#guard);
		cancelAnimationFrame(this.#raf);
		this.#raf = 0;
		const sp = this.#spring;
		if (sp) {
			// Interrupted mid-flight: the layers are where the spring is now, not at its target.
			this.#amount = springAt(sp.x0, sp.v0, sp.to, Number(sp.lead.currentTime ?? 0) / 1000);
			this.#spring = null;
		}
		for (const a of this.#anims) a.cancel();
		this.#anims = [];
	}

	/** Rest: let Svelte apply the committed selection, drop the transforms, then put natives back. */
	async #finish() {
		const h = this.#host;
		if (!h || !this.#active) return;
		this.#active = false;
		this.#spring = null;
		const gen = this.#gen;
		// The animations hold the end pose (`fill: forwards`) while Svelte applies the new roles; only
		// once the rest layout is in the DOM are they dropped, so no frame shows an in-between state.
		await h.flush();
		if (gen !== this.#gen) return; // a new gesture took over while Svelte was applying the switch
		this.#stopSpring();
		this.#clear();
		h.moving(false);
	}

	/** Abort without animation (new gesture, detach). */
	#end() {
		this.#stopSpring();
		if (!this.#active) return;
		this.#active = false;
		this.#clear();
		this.#host?.moving(false);
	}

	#clear() {
		const h = this.#host;
		if (h) for (const id of [this.#out, this.#inc]) if (id) h.layer(id)?.style.removeProperty("transform");
		this.#out = this.#inc = null;
		this.#amount = this.#velocity = this.#lastT = this.#grace = 0;
		this.#committed = false;
	}
}

export const spacePager = new Pager();
