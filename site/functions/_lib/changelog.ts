// Pure pieces of the changelog engine (no I/O, unit-tested in changelog.test.ts): split CHANGELOG.md into versions,
// drop [Unreleased], and render each entry to HTML. Anything dynamic (fetching, caching) lives in edge.ts.
import { marked } from "marked";

export interface Entry {
	/** "1.2.0" */
	version: string;
	/** "2026-10-12" ("" when the heading has no date) */
	date: string;
	/** Anchor id, "v1-2-0" */
	id: string;
	/** Markdown of the section body (without the "## [x] — date" heading) */
	body: string;
}
export interface Parsed {
	/** Everything before the first version heading (title, intro, alpha notice) */
	intro: string;
	entries: Entry[];
}

const HEADING = /^## \[([^\]]+)\](?:\s*[—–-]\s*(\d{4}-\d{2}-\d{2}))?[^\n]*$/gm;

export const versionId = (v: string) => `v${v.replace(/[^0-9A-Za-z]+/g, "-").replace(/^-|-$/g, "")}`;

/** SemVer-ish compare, newest first when used as `sort(cmpVersionDesc)`. Pre-release tags sort before the release. */
export function cmpVersionDesc(a: string, b: string): number {
	const [an, ap = ""] = a.split("-", 2);
	const [bn, bp = ""] = b.split("-", 2);
	const x = an.split(".").map(Number);
	const y = bn.split(".").map(Number);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (y[i] ?? 0) - (x[i] ?? 0);
		if (d) return d;
	}
	return ap === bp ? 0 : ap === "" ? -1 : bp === "" ? 1 : bp.localeCompare(ap);
}

/** Splits the markdown into its intro and one entry per `## [version]` heading. `[Unreleased]` is never public. */
export function parseChangelog(md: string): Parsed {
	const text = md.replace(/\r\n/g, "\n");
	const marks = [...text.matchAll(HEADING)];
	const intro = (marks.length ? text.slice(0, marks[0].index) : text).trim();
	const entries: Entry[] = [];
	marks.forEach((m, i) => {
		const version = m[1].trim();
		if (/^unreleased$/i.test(version)) return;
		const start = (m.index ?? 0) + m[0].length;
		const end = i + 1 < marks.length ? marks[i + 1].index : text.length;
		entries.push({ version, date: m[2] ?? "", id: versionId(version), body: text.slice(start, end).trim() });
	});
	return { intro, entries };
}

const slug = (s: string) => s.toLowerCase().replace(/<[^>]+>/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Markdown to HTML with the site's rules: raw HTML is escaped (the source is a public repo, not trusted input),
 * external links open safely, and `###` headings get ids scoped to their version so anchors never collide. */
export function renderMarkdown(md: string, scope = ""): string {
	const seen = new Map<string, number>();
	const renderer = new marked.Renderer();
	renderer.html = ({ text }) => esc(text);
	renderer.heading = function ({ tokens, depth }) {
		const inner = this.parser.parseInline(tokens);
		const base = `${scope ? scope + "-" : ""}${slug(inner)}`;
		const n = (seen.get(base) ?? 0) + 1;
		seen.set(base, n);
		const id = n === 1 ? base : `${base}-${n}`;
		return `<h${depth} id="${id}">${inner}</h${depth}>\n`;
	};
	renderer.link = function ({ href, title, tokens }) {
		const text = this.parser.parseInline(tokens);
		const safe = /^(https?:|mailto:|#|\/)/i.test(href) ? href : "#";
		const ext = /^https?:/i.test(safe) && !safe.startsWith("https://atlas.codeatlas.com.br");
		return `<a href="${esc(safe)}"${title ? ` title="${esc(title)}"` : ""}${ext ? ' rel="noopener"' : ""}>${text}</a>`;
	};
	return marked.parse(md, { renderer, gfm: true, async: false }) as string;
}

export interface Rendered {
	version: string;
	date: string;
	id: string;
	html: string;
}

export function renderChangelog(md: string): { introHtml: string; entries: Rendered[] } {
	const { intro, entries } = parseChangelog(md);
	// The intro repeats the page's own h1 ("# Changelog"); the page template draws that.
	const introHtml = renderMarkdown(intro.replace(/^# .*\n+/, ""), "intro");
	return {
		introHtml,
		entries: entries
			.sort((a, b) => cmpVersionDesc(a.version, b.version))
			.map((e) => ({ version: e.version, date: e.date, id: e.id, html: renderMarkdown(e.body, e.id) })),
	};
}
