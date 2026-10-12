/**
 * Keeps the native terminal view (a child view painted above the webview) in step with its DOM
 * slot: opens it once, tracks bounds/visibility, and builds the color and pref payloads.
 */

import { invoke } from "@tauri-apps/api/core";
import { toast } from "@codeatlasdev/ui";
import { errText } from "#lib/api.ts";
import { gpu } from "#lib/stores/gpu.svelte.ts";
import { prefs } from "#lib/stores/prefs.svelte.ts";
import { themes } from "#lib/stores/theme.svelte.ts";
import { overlayOpen } from "../nativeSlot.ts";

/** Theme color as #rrggbb (the kit uses oklch; a canvas normalizes any CSS color). */
function hex(el: Element, cssVar: string, fallback: string): string {
	const v = getComputedStyle(el).getPropertyValue(cssVar).trim() || fallback;
	const ctx = document.createElement("canvas").getContext("2d")!;
	ctx.fillStyle = v;
	ctx.fillRect(0, 0, 1, 1);
	const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
	return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

function termColors(el: Element) {
	return {
		fg: themes.terminal?.fg ?? hex(el, "--ca-text-primary", "#e6e6e6"),
		bg: themes.terminal?.bg ?? hex(el, "--ca-surface-base", "#111111"),
		ansi16: themes.terminal?.ansi16,
		min_contrast: prefs.value.terminal.minimum_contrast,
	};
}

export function termPrefs() {
	const t = prefs.value.terminal;
	return {
		font_size: t.font_size,
		scrollback: t.max_scroll_history_lines,
		cursor_shape: t.cursor_shape,
		cursor_blink: t.blinking,
		osc52: t.osc52,
		ligatures: t.ligatures,
	};
}

export class NativeView {
	opened = false;
	#failed = false;
	// Observers fire concurrently; serialize so `term_open` runs once before any `term_bounds`.
	#chain = Promise.resolve();

	constructor(
		private ids: () => { tab: string; pty: string },
		private area: () => HTMLElement | undefined,
		private visible: () => boolean,
	) {}

	sync = () => {
		this.#chain = this.#chain.then(() => this.#apply());
		return this.#chain;
	};

	async #apply() {
		const area = this.area();
		if (!area || this.#failed) return;
		const { tab, pty } = this.ids();
		const r = area.getBoundingClientRect();
		const rect = { x: r.left, y: r.top, w: r.width, h: r.height };
		// The native view sits above the webview: park it under dialogs/palette.
		const show =
			this.visible() &&
			r.width > 0 &&
			r.height > 0 &&
			!document.querySelector("[role=dialog][data-state=open]");
		try {
			if (!this.opened) {
				if (!show) return;
				this.opened = true;
				await invoke("term_open", { tab, pty, ...rect, ...termColors(area), prefs: termPrefs() });
			}
			await invoke("term_bounds", { tab, ...rect, visible: show });
		} catch (e) {
			this.#failed = true;
			const msg = errText(e);
			// A host that predates the raw stream and could not be replaced: xterm.js until it
			// restarts. (The app normally upgrades it live on connect, see `host.rs`.)
			if (msg.includes("pty_attach_raw")) {
				if (!gpu.hostTooOld)
					toast.info("GPU terminal turns on after the terminal host restarts (Settings → Terminal).");
				gpu.hostTooOld = true;
			} else toast.error(msg);
		}
	}

	/** Recolor live after a theme switch. */
	recolor() {
		const area = this.area();
		if (this.opened && area)
			void invoke("term_recolor", { tab: this.ids().tab, ...termColors(area) }).catch(() => {});
	}

	/** Push `terminal.*` settings live: scrollback, cursor, OSC 52. */
	setPrefs() {
		const p = termPrefs();
		if (this.opened) void invoke("term_set_prefs", { tab: this.ids().tab, prefs: p }).catch(() => {});
	}
}
