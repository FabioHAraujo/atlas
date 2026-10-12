// HTML pieces shared by the static build (offline fallback) and the edge function, so both render the same markup.
import type { Rendered } from "./changelog";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "");

export interface BodyOpts {
	/** Release tag the changelog was read from ("" for the offline fallback) */
	tag: string;
	/** GitHub could not be reached; this is the last good copy */
	stale: boolean;
	/** Rendered at build time from the checkout, not from the latest release */
	fallback?: boolean;
}

/** The inside of <article data-changelog>: intro, version jump list, one <section> per version. */
export function changelogBody(c: { introHtml: string; entries: Rendered[] }, o: BodyOpts): string {
	const jump = c.entries.map((e) => `<li><a href="#${e.id}">${esc(e.version)}</a></li>`).join("");
	const sections = c.entries
		.map(
			(e) =>
				`<section id="${e.id}" aria-labelledby="${e.id}-h"><h2 id="${e.id}-h"><a href="#${e.id}" style="text-decoration:none">${esc(e.version)}</a></h2>` +
				`<p class="cl-meta">${e.date ? `<time datetime="${e.date}">${fmtDate(e.date)}</time>` : ""}<a href="https://github.com/codeatlasdev/atlas/releases/tag/v${esc(e.version)}" rel="noopener">Release page and downloads</a></p>${e.html}</section>`,
		)
		.join("\n");
	const note = o.stale ? `<p class="cl-stale" role="status">GitHub is unreachable right now, so this is the last copy we fetched${o.tag ? ` (${esc(o.tag)})` : ""}. It refreshes by itself.</p>` : "";
	return `${note}${c.introHtml}<nav aria-label="Versions"><ul class="cl-jump">${jump}</ul></nav>\n${sections}`;
}
