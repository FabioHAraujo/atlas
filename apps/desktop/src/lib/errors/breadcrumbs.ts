/**
 * The last things the app did, kept in memory so an error report says what led to it. Entries are
 * short labels (a command name, a navigation), never payloads; text is scrubbed like error messages.
 */
import { scrub, type Breadcrumb } from "./report.ts";

const MAX_TEXT = 200;

export class Crumbs {
	#items: (Breadcrumb & { n: number; base: string })[] = [];

	constructor(readonly cap = 40) {}

	add(text: string, at = Date.now()) {
		const base = scrub(text.replace(/\s+/g, " ")).slice(0, MAX_TEXT - 8);
		const last = this.#items.at(-1);
		if (last && last.base === base) {
			last.n += 1;
			last.at = at;
			return;
		}
		this.#items.push({ at, text: base, n: 1, base });
		if (this.#items.length > this.cap) this.#items.shift();
	}

	snapshot(): Breadcrumb[] {
		return this.#items.map((b) => ({ at: b.at, text: b.n > 1 ? `${b.base} ×${b.n}` : b.base }));
	}
}

export const crumbs = new Crumbs();
