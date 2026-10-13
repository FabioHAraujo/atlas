/** sRGB hex ⇄ OKLCH, alpha mixing and WCAG contrast. Pure; theme derivation is computed in OKLCH. */

export interface Rgb {
	r: number;
	g: number;
	b: number;
}

export interface Oklch {
	l: number;
	c: number;
	h: number;
}

const HEX = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;

/** `#rrggbb`/`#rrggbbaa` only; anything else is ignored rather than written into CSS. */
export function color(v: unknown): string | undefined {
	return typeof v === "string" && HEX.test(v) ? v.toLowerCase() : undefined;
}

/** `#rrggbb` part of a color (alpha dropped). */
export const opaque = (hex: string): string => hex.slice(0, 7);

export function parseHex(hex: string): Rgb & { a: number } {
	const h = hex.replace("#", "");
	const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
	return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
}

const byte = (v: number) => Math.round(Math.min(255, Math.max(0, v)));
const hex2 = (v: number) => byte(v).toString(16).padStart(2, "0");

export function toHex(c: Rgb, a = 1): string {
	const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
	return a >= 1 ? base : `${base}${hex2(a * 255)}`;
}

const toLinear = (v: number) => {
	const f = v / 255;
	return f <= 0.04045 ? f / 12.92 : ((f + 0.055) / 1.055) ** 2.4;
};
const fromLinear = (v: number) => {
	const f = v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055;
	return f * 255;
};

export function toOklch(hex: string): Oklch {
	const { r, g, b } = parseHex(hex);
	const [lr, lg, lb] = [toLinear(r), toLinear(g), toLinear(b)];
	const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
	const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
	const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
	const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
	const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
	const c = Math.hypot(A, B);
	return { l: L, c, h: c < 1e-4 ? 0 : ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360 };
}

function oklchToLinear({ l: L, c, h }: Oklch): [number, number, number] {
	const A = c * Math.cos((h * Math.PI) / 180);
	const B = c * Math.sin((h * Math.PI) / 180);
	const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
	const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
	const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
	return [
		4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
		-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
		-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
	];
}

const inGamut = (v: [number, number, number]) => v.every((x) => x >= -0.0005 && x <= 1.0005);

/** OKLCH → sRGB hex, reducing chroma until the color is inside the sRGB gamut. */
export function fromOklch(o: Oklch, a = 1): string {
	let c = Math.max(0, o.c);
	const l = Math.min(1, Math.max(0, o.l));
	let lin = oklchToLinear({ l, c, h: o.h });
	for (let i = 0; i < 24 && !inGamut(lin); i++) {
		c *= 0.92;
		lin = oklchToLinear({ l, c, h: o.h });
	}
	const [r, g, b] = lin.map((x) => fromLinear(Math.min(1, Math.max(0, x))));
	return toHex({ r, g, b }, a);
}

/** WCAG relative luminance of an opaque color. */
export function luminance(hex: string): number {
	const { r, g, b } = parseHex(hex);
	return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** WCAG contrast ratio (1…21) between two opaque colors. */
export function contrast(a: string, b: string): number {
	const [la, lb] = [luminance(a), luminance(b)];
	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** `fg` at `alpha` composited over opaque `bg`, as opaque hex. */
export function over(fg: string, bg: string, alpha: number): string {
	const f = parseHex(fg);
	const b = parseHex(bg);
	const a = alpha * f.a;
	return toHex({ r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a) });
}

/** `hex` with its alpha replaced by `alpha` (0…1). */
export const withAlpha = (hex: string, alpha: number): string => toHex(parseHex(hex), alpha);

/** Mix two opaque colors in OKLab-ish space via OKLCH lightness/chroma interpolation (`t` = share of `b`). */
export function mix(a: string, b: string, t: number): string {
	const [x, y] = [toOklch(a), toOklch(b)];
	const dh = ((y.h - x.h + 540) % 360) - 180;
	return fromOklch({
		l: x.l + (y.l - x.l) * t,
		c: x.c + (y.c - x.c) * t,
		h: (x.h + dh * t + 360) % 360,
	});
}

/** Move `fg` along lightness until it reaches `min` contrast on `bg` (keeps hue and chroma). */
export function ensureContrast(fg: string, bg: string, min: number): string {
	if (contrast(fg, bg) >= min) return fg;
	const o = toOklch(fg);
	const towardLight = luminance(bg) < 0.18;
	for (let i = 1; i <= 40; i++) {
		const l = towardLight ? o.l + i * 0.015 : o.l - i * 0.015;
		const out = fromOklch({ ...o, l });
		if (contrast(out, bg) >= min || l <= 0 || l >= 1) return out;
	}
	return towardLight ? "#ffffff" : "#000000";
}

export const isDark = (bg: string): boolean => luminance(bg) < 0.18;

/** Black or white, whichever reads better on the opaque fill `bg` (ties go to white). */
export const readableOn = (bg: string): "#ffffff" | "#000000" =>
	contrast("#ffffff", bg) >= contrast("#000000", bg) ? "#ffffff" : "#000000";

/**
 * What the GPU terminal draws for `fg` on `bg` at `minimum`: `fg` itself when it already reads, else lerped toward
 * white (dark `bg`) or black (light `bg`) in 16 steps until it does: the same rule as `Palette::enforce_contrast`
 * (`atlas-term/src/colors.rs`), so a preview shows what the terminal shows. `minimum <= 1` is off.
 */
export function terminalLift(fg: string, bg: string, minimum: number): string {
	if (minimum <= 1 || contrast(fg, bg) >= minimum) return fg;
	const target = luminance(bg) > 0.18 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 };
	const f = parseHex(fg);
	let c = { r: f.r, g: f.g, b: f.b };
	for (let step = 1; step <= 16; step++) {
		// the Rust lerp: c + (target - c) * step / 16, truncated, from the previous step's colour
		c = {
			r: c.r + Math.trunc(((target.r - c.r) * step) / 16),
			g: c.g + Math.trunc(((target.g - c.g) * step) / 16),
			b: c.b + Math.trunc(((target.b - c.b) * step) / 16),
		};
		if (contrast(toHex(c), bg) >= minimum) break;
	}
	return toHex(c);
}
