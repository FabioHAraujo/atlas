/**
 * The contrast audit of the agent bridge (`atlas desktop debug contrast`): for every visible text node the effective
 * foreground (its colour times the opacity of the whole ancestor chain) against the effective background (translucent
 * layers composited down to the first opaque one), WCAG ratio against the threshold the text's size/weight/role needs.
 * Measured on the real computed styles of the running page, so it sees what tokens, `opacity:` and `color-mix()` end
 * up as. Pure maths first (parse, composite, ratio, threshold), then the DOM walk.
 *
 * Thresholds: 4.5 body, 3 large (>= 24 px, or >= 18.66 px bold) and UI icons. Disabled controls and placeholders
 * are exempt from AA by WCAG; we hold them to 3 so they still read.
 */
import { fromOklch, parseHex } from "../theme/color.ts";

export interface Rgba {
	r: number;
	g: number;
	b: number;
	a: number;
}

const clamp255 = (v: number) => Math.round(Math.min(255, Math.max(0, v)));

/**
 * The colour forms `getComputedStyle` yields: `rgb()/rgba()`, `#hex`, `transparent`, and (WebKit, for `color-mix()` and
 * the kit's OKLCH tokens) `oklab()`, `oklch()`, `color(srgb …)`. Anything else is undefined: never a guess.
 */
export function parseCssColor(v: string): Rgba | undefined {
	const s = v.trim().toLowerCase();
	if (s === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
	const hex = /^#([0-9a-f]{3,8})$/.exec(s)?.[1];
	if (hex) {
		const h = hex.length <= 4 ? [...hex].map((c) => c + c).join("") : hex;
		if (h.length !== 6 && h.length !== 8) return undefined;
		const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
		return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
	}
	const m = /^(rgba?|oklab|oklch|color)\(\s*([^)]+)\)$/.exec(s);
	if (!m) return undefined;
	const [, fn, body] = m;
	// `%` is a fraction of the channel's range; `none` is 0.
	const parts = body!.split(/[\s,/]+/).filter(Boolean);
	if (fn === "color") {
		if (parts.shift() !== "srgb") return undefined;
	}
	if (parts.length < 3 || parts.length > 4) return undefined;
	const num = (p: string, range: number) =>
		p === "none" ? 0 : p.endsWith("%") ? (parseFloat(p) / 100) * range : parseFloat(p);
	const a = parts[3] === undefined ? 1 : num(parts[3], 1);
	let rgb: Pick<Rgba, "r" | "g" | "b">;
	if (fn === "oklab") {
		const [L, A, B] = [num(parts[0]!, 1), num(parts[1]!, 0.4), num(parts[2]!, 0.4)];
		rgb = parseHex(
			fromOklch({ l: L, c: Math.hypot(A, B), h: ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 }),
		);
	} else if (fn === "oklch") {
		rgb = parseHex(fromOklch({ l: num(parts[0]!, 1), c: num(parts[1]!, 0.4), h: num(parts[2]!, 360) }));
	} else {
		// rgb(): channels 0…255 (or %); color(srgb): channels 0…1 (or %).
		const full = fn === "color" ? 255 : 1;
		const ch = parts
			.slice(0, 3)
			.map((p) => (p.endsWith("%") ? (parseFloat(p) * 255) / 100 : parseFloat(p) * full));
		rgb = { r: ch[0]!, g: ch[1]!, b: ch[2]! };
	}
	const out = { r: rgb.r, g: rgb.g, b: rgb.b, a };
	return Object.values(out).some(Number.isNaN) ? undefined : out;
}

/** `top` over `bottom`; the result is as opaque as the layers allow. */
export function composite(top: Rgba, bottom: Rgba): Rgba {
	const a = top.a + bottom.a * (1 - top.a);
	if (a <= 0) return { r: 0, g: 0, b: 0, a: 0 };
	const mix = (t: number, b: number) => clamp255((t * top.a + b * bottom.a * (1 - top.a)) / a);
	return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a };
}

const lin = (c: number) => {
	const s = c / 255;
	return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const lum = (c: Rgba) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);

/** WCAG contrast ratio of two opaque colours, 1…21, symmetric. */
export function ratio(a: Rgba, b: Rgba): number {
	const [x, y] = [lum(a), lum(b)];
	return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** AA threshold for a text run (`icon`: a glyph that is UI, not prose). */
export function requiredRatio(t: {
	sizePx: number;
	weight: number;
	icon?: boolean;
	relaxed?: boolean;
}): number {
	if (t.icon || t.relaxed) return 3;
	const large = t.sizePx >= 24 || (t.sizePx >= 18.66 && t.weight >= 600);
	return large ? 3 : 4.5;
}

const hex = (c: Rgba) => `#${[c.r, c.g, c.b].map((v) => clamp255(v).toString(16).padStart(2, "0")).join("")}`;

export type Background = { kind: "color"; color: Rgba } | { kind: "unknown"; reason: string };

const CANVAS: Rgba = { r: 255, g: 255, b: 255, a: 1 };

/** An element's own paint: its background colour (or `unknown` when an image/gradient/unparseable colour is on top). */
function ownPaint(cs: CSSStyleDeclaration): Rgba | "unknown" | undefined {
	if (cs.backgroundImage && cs.backgroundImage !== "none" && cs.backgroundImage !== "initial")
		return "unknown";
	const raw = cs.backgroundColor;
	if (!raw) return undefined;
	const c = parseCssColor(raw);
	if (!c) return "unknown";
	return c.a > 0 ? c : undefined;
}

/**
 * Composite the element's ancestor backgrounds, nearest first, until an opaque layer; the page canvas is white.
 * An ancestor that paints with a canvas/WebGL (no CSS background) declares its effective colour with
 * `data-contrast-bg="#rrggbb"`, which acts as an opaque layer there.
 */
export function effectiveBackground(el: Element): Background {
	const layers: Rgba[] = [];
	let base = CANVAS;
	for (let n: Element | null = el; n; n = n.parentElement) {
		const paint = ownPaint(getComputedStyle(n));
		if (paint === "unknown")
			return { kind: "unknown", reason: `${describe(n)} paints an image, gradient or unreadable colour` };
		if (paint) {
			layers.push(paint);
			if (paint.a >= 1) break;
		}
		const declared = n.getAttribute("data-contrast-bg");
		if (declared !== null) {
			const c = parseCssColor(declared);
			if (!c) return { kind: "unknown", reason: `${describe(n)} declares an unreadable data-contrast-bg` };
			base = { ...c, a: 1 };
			break;
		}
	}
	return { kind: "color", color: layers.reduceRight((below, top) => composite(top, below), base) };
}

/** `tag#id.class.class` — enough to find the element again. */
function describe(el: Element): string {
	const cls = [...el.classList].slice(0, 3).join(".");
	return `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ""}${cls ? `.${cls}` : ""}`;
}

/** The selector path of an element, up to 4 ancestors, so a failure is findable. */
function selectorOf(el: Element): string {
	const path: string[] = [];
	for (let n: Element | null = el; n && n !== document.body && path.length < 4; n = n.parentElement)
		path.unshift(describe(n));
	return path.join(" > ");
}

/** The product of `opacity` over the element and every ancestor. */
function opacityChain(el: Element): number {
	let o = 1;
	for (let n: Element | null = el; n; n = n.parentElement) {
		const v = parseFloat(getComputedStyle(n).opacity);
		if (!Number.isNaN(v)) o *= v;
	}
	return o;
}

/** Theme/kit custom properties, set inline on the element, its ancestors or `<html>` (where the theme engine writes them). */
const TOKEN_PREFIXES = ["--ca-", "--atlas-", "--cm-"];

/** Whether two colours are the same to the byte (alpha to 1%). */
const same = (a: Rgba, b: Rgba) => a.r === b.r && a.g === b.g && a.b === b.b && Math.abs(a.a - b.a) < 0.01;

/**
 * The tokens that ARE the colour: custom properties whose parsed value equals the element's own text colour (`fg`)
 * or the effective background (`bg`). Naming every inherited var would bury the one that matters.
 */
function tokensOf(el: Element, fg: Rgba, bg: Rgba): { fg: string[]; bg: string[] } {
	const out = { fg: new Set<string>(), bg: new Set<string>() };
	for (let n: Element | null = el; n; n = n.parentElement) {
		const st = (n as HTMLElement).style;
		for (let i = 0; st && i < st.length; i++) {
			const k = st[i]!;
			if (!TOKEN_PREFIXES.some((p) => k.startsWith(p))) continue;
			const v = parseCssColor(st.getPropertyValue(k));
			if (!v) continue;
			if (same(v, fg)) out.fg.add(k);
			if (same(v, bg)) out.bg.add(k);
		}
	}
	return { fg: [...out.fg].sort(), bg: [...out.bg].sort() };
}

export interface Finding {
	selector: string;
	text: string;
	ratio: number;
	required: number;
	fg: string;
	bg: string;
	sizePx: number;
	weight: number;
	/** Theme tokens (`--ca-*`…) whose value is the text colour (`fg`) or the surface under it (`bg`). */
	vars: { fg: string[]; bg: string[] };
}
export interface Unknown {
	selector: string;
	text: string;
	reason: string;
}
export interface Report {
	checked: number;
	/** Text runs inside a `data-contrast-ignore` subtree (a theme preview paints another theme's colours on purpose). */
	ignored: number;
	failures: Finding[];
	/** Editor syntax colours below their floor: a theme's own palette (pinned by specs such as Dracula's), listed apart from the UI failures. */
	code: Finding[];
	unknown: Unknown[];
	top: { selector: string; count: number }[];
}

const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "SVG", "CANVAS", "TEMPLATE"]);

/** Is the element's text actually on screen: laid out, not `visibility:hidden`/`display:none`, not fully transparent. */
function shown(el: Element, cs: CSSStyleDeclaration): boolean {
	if (SKIP.has(el.tagName.toUpperCase())) return false;
	if (cs.display === "none" || cs.visibility === "hidden" || cs.visibility === "collapse") return false;
	const r = el.getBoundingClientRect();
	if (r.width === 0 && r.height === 0) return false;
	return (el as HTMLElement).offsetParent !== null || cs.position === "fixed";
}

/** Disabled controls, placeholders and the editor's line-number gutter are exempt from AA by WCAG; held to 3 here. */
const relaxed = (el: Element) =>
	(el as HTMLButtonElement).disabled === true ||
	el.getAttribute("aria-disabled") === "true" ||
	!!el.closest("[disabled],[aria-disabled=true]") ||
	// the editor's line-number gutter: incidental, like a placeholder; Atlas still holds it to 3:1
	!!el.closest(".cm-lineNumbers, .cm-gutterElement");

/** Own, direct text of an element (not its children's), collapsed. */
const ownText = (el: Element) =>
	[...el.childNodes]
		.filter((n) => n.nodeType === 3)
		.map((n) => n.textContent ?? "")
		.join(" ")
		.replace(/\s+/g, " ")
		.trim();

export function contrastAudit(root: Element): Report {
	const failures: Finding[] = [];
	const code: Finding[] = [];
	const unknown: Unknown[] = [];
	let checked = 0;
	let ignored = 0;
	const els = [root, ...root.querySelectorAll("*")];
	for (const el of els) {
		const text = ownText(el);
		if (!text) continue;
		if (el.closest("[data-contrast-ignore]")) {
			ignored++;
			continue;
		}
		const cs = getComputedStyle(el);
		if (!shown(el, cs)) continue;
		const alpha = opacityChain(el);
		if (alpha < 0.02) continue;
		const fg0 = parseCssColor(cs.color);
		const bg = effectiveBackground(el);
		if (!fg0 || bg.kind === "unknown") {
			unknown.push({
				selector: selectorOf(el),
				text: text.slice(0, 60),
				reason: bg.kind === "unknown" ? bg.reason : `unreadable colour ${cs.color}`,
			});
			continue;
		}
		checked++;
		const fg = composite({ ...fg0, a: fg0.a * alpha }, bg.color);
		const sizePx = parseFloat(cs.fontSize) || 16;
		const weight = parseInt(cs.fontWeight, 10) || (cs.fontWeight === "bold" ? 700 : 400);
		const required = requiredRatio({ sizePx, weight, relaxed: relaxed(el) });
		const r = ratio(fg, bg.color);
		if (r + 1e-9 < required)
			(el.closest(".cm-content") ? code : failures).push({
				selector: selectorOf(el),
				text: text.slice(0, 60),
				ratio: Math.round(r * 100) / 100,
				required,
				fg: hex(fg),
				bg: hex(bg.color),
				sizePx,
				weight,
				vars: tokensOf(el, fg0, bg.color),
			});
	}
	return { checked, ignored, failures, code, unknown, top: summarize(failures) };
}

/** Failures grouped by selector, most frequent first: where to start. */
export function summarize(f: Pick<Finding, "selector">[]): { selector: string; count: number }[] {
	const by = new Map<string, number>();
	for (const x of f) by.set(x.selector, (by.get(x.selector) ?? 0) + 1);
	return [...by]
		.map(([selector, count]) => ({ selector, count }))
		.sort((a, b) => b.count - a.count || a.selector.localeCompare(b.selector));
}
