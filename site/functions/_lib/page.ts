// HTML pieces shared by the static build (offline fallback) and the edge function, so both render the same markup.
import type { Kind, Rendered } from "./changelog";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtDate = (iso: string) => (iso ? new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }) : "");

const BADGE: Record<Exclude<Kind, "stable">, string> = { alpha: "Alpha", beta: "Beta", rc: "RC", pre: "Pre-release" };

/** "All / Stable only / Prereleases". Rendered `hidden`: the page script (changelog/index.astro) reveals and drives it, so
 * without JavaScript there is no dead control and every version stays visible. Only emitted when there is a prerelease to filter. */
const FILTER = `<fieldset class="cl-filter" data-cl-filter hidden><legend>Show</legend>` +
	`<label><input type="radio" name="cl-filter" value="all" checked> All</label>` +
	`<label><input type="radio" name="cl-filter" value="stable"> Stable only</label>` +
	`<label><input type="radio" name="cl-filter" value="pre"> Prereleases</label><span class="cl-count" data-cl-count role="status"></span></fieldset>`;

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
	const attrs = (e: Rendered) => ` data-version="${esc(e.version)}" data-kind="${e.kind}"${e.superseded ? " data-superseded" : ""}`;
	const badge = (e: Rendered) => (e.kind === "stable" ? "" : ` <span class="cl-badge cl-badge-${e.kind}">${BADGE[e.kind]}</span>`);
	const jump = c.entries.map((e) => `<li${attrs(e)}><a href="#${e.id}">${esc(e.version)}</a>${badge(e)}</li>`).join("");
	const sections = c.entries
		.map(
			(e) =>
				`<section id="${e.id}"${attrs(e)} aria-labelledby="${e.id}-h"><h2 id="${e.id}-h"><a href="#${e.id}" style="text-decoration:none">${esc(e.version)}</a>${badge(e)}</h2>` +
				`<p class="cl-meta">${e.date ? `<time datetime="${e.date}">${fmtDate(e.date)}</time>` : ""}<a href="https://github.com/codeatlasdev/atlas/releases/tag/v${esc(e.version)}" rel="noopener">Release page and downloads</a></p>${e.html}</section>`,
		)
		.join("\n");
	const note = o.stale ? `<p class="cl-stale" role="status">GitHub is unreachable right now, so this is the last copy we fetched${o.tag ? ` (${esc(o.tag)})` : ""}. It refreshes by itself.</p>` : "";
	return `${note}${c.introHtml}${c.entries.some((e) => e.kind !== "stable") ? FILTER : ""}<nav aria-label="Versions"><ul class="cl-jump">${jump}</ul></nav>\n${sections}`;
}
