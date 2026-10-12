/**
 * Mouse handling for the GPU terminal: selection (click, drag, multi-click, block), ⌘-hover and
 * ⌘-click on URLs, click-to-move, wheel scroll. The renderer owns the selection; this only feeds
 * it cells and decides what a press means.
 */

import { invoke } from "@tauri-apps/api/core";
import { cellAt, cellFromStats, wheelLines, type Cell, type CellHit } from "./geometry.ts";

interface Options {
	tab: () => string;
	/** The element whose top-left is cell (0, 0). */
	area: () => HTMLElement | undefined;
	/** Focus the keyboard sink (the mousedown default would blur it). */
	focusInput: () => void;
	readonly: () => boolean;
	/** `terminal.click_to_move` / `terminal.copy_on_select`. */
	prefs: () => { click_to_move: boolean; copy_on_select: boolean };
	onLink: (url: string, external: boolean) => void;
}

const quiet = () => {};

export class Pointer {
	/** Exact cell size reported by the renderer; refreshed per press (resizes change it). */
	#cell: Cell | null = null;
	#selecting = false;
	/** Cell of an in-progress plain click; cleared once the pointer leaves it. */
	#press: { col: number; row: number } | null = null;
	/** A URL underline is showing (cleared when ⌘ is released or the pointer leaves). */
	#hovered = false;
	#lastHover = "";
	#o: Options;

	constructor(options: Options) {
		this.#o = options;
	}

	async #fetchCell() {
		const s = await invoke<Record<string, { cell_w: number; cell_h: number }>>("term_stats");
		this.#cell = cellFromStats(s[this.#o.tab()]);
	}

	#toCell(e: MouseEvent): CellHit | null {
		const area = this.#o.area();
		return area && this.#cell ? cellAt(e.clientX, e.clientY, area.getBoundingClientRect(), this.#cell) : null;
	}

	#update(c: CellHit) {
		void invoke("term_select_update", { tab: this.#o.tab(), col: c.col, row: c.row, frac: c.frac }).catch(
			quiet,
		);
	}

	mousedown = async (e: MouseEvent) => {
		if (e.button !== 0) return;
		const tab = this.#o.tab();
		// Keep the textarea focused for keys/paste (the mousedown default would blur it).
		e.preventDefault();
		this.#o.focusInput();
		await this.#fetchCell().catch(quiet);
		const c = this.#toCell(e);
		if (!c) return;
		if (e.metaKey) {
			const url = await invoke<string | null>("term_hyperlink_at", { tab, col: c.col, row: c.row }).catch(
				() => null,
			);
			if (url) {
				this.#hovered = false;
				void invoke("term_hover", { tab }).catch(quiet);
				this.#o.onLink(url, true);
				return;
			}
		}
		this.#selecting = true;
		// A plain single click may be a click-to-move; a drag or a multi-click is a selection.
		this.#press =
			e.detail === 1 && !e.altKey && !e.shiftKey && !e.metaKey ? { col: c.col, row: c.row } : null;
		void invoke("term_select_start", {
			tab,
			col: c.col,
			row: c.row,
			frac: c.frac,
			clicks: Math.min(e.detail, 3),
			block: e.altKey,
		}).catch(quiet);
	};

	mousemove = (e: MouseEvent) => {
		if (!this.#selecting) return this.#hoverUrl(e);
		if (!(e.buttons & 1)) return void this.mouseup(e);
		const c = this.#toCell(e);
		if (c && this.#press && (c.col !== this.#press.col || c.row !== this.#press.row)) this.#press = null;
		if (c) this.#update(c);
	};

	mouseup = async (e: MouseEvent) => {
		if (!this.#selecting) return;
		this.#selecting = false;
		const tab = this.#o.tab();
		const c = this.#toCell(e);
		const click =
			this.#press && c && c.col === this.#press.col && c.row === this.#press.row ? this.#press : null;
		this.#press = null;
		if (c) this.#update(c);
		const t = this.#o.prefs();
		// Ghostty `cursor-click-to-move`: a click on the prompt line moves the shell's cursor there.
		if (click && t.click_to_move && !this.#o.readonly()) {
			const moved = await invoke<boolean>("term_click_move", { tab, col: click.col, row: click.row }).catch(
				() => false,
			);
			if (moved) return void invoke("term_clear_selection", { tab }).catch(quiet);
		}
		void invoke("term_select_end", { tab, copy: t.copy_on_select }).catch(quiet);
	};

	wheel = (e: WheelEvent) => {
		e.preventDefault();
		const lines = wheelLines(e.deltaY, this.#cell);
		if (lines) void invoke("term_scroll", { tab: this.#o.tab(), delta: lines }).catch(quiet);
	};

	#hoverUrl(e: MouseEvent) {
		if (!e.metaKey) return this.clearHover();
		const c = this.#toCell(e);
		if (!c) return;
		const key = `${c.col},${c.row}`;
		if (key === this.#lastHover) return;
		this.#lastHover = key;
		this.#hovered = true;
		void invoke("term_hover", { tab: this.#o.tab(), col: c.col, row: c.row }).catch(quiet);
	}

	clearHover = () => {
		this.#lastHover = "";
		if (!this.#hovered) return;
		this.#hovered = false;
		void invoke("term_hover", { tab: this.#o.tab() }).catch(quiet);
	};
}
