/**
 * Paints one `Frame` of the intro on a 2D canvas. Stateless: the same `(frame, size, theme)` always gives the same
 * pixels, so the live animation, the storyboard screenshots and the timeline tests agree.
 *
 * Look: a black stage; the real logo tiles lit as a sphere (key light, rim, specular), a light streak behind every
 * flying tile, tiles growing as they come toward the camera, crisp radial beams on the hit, one specular glint sweeping
 * the globe, then the camera pushes into it.
 */
import { MARK, MARK_VIEW } from "./mark.ts";
import { ribbon, camera } from "./ribbon.ts";
import { GLOBE, normalAt, shade } from "./shade.ts";
import { BEATS, TILES, WORD, wordmark, type Frame } from "./timeline.ts";

export interface Theme {
	/** Logo gradient stops (the real Atlas mark: light, mid, deep). */
	light: string;
	mid: string;
	deep: string;
	/** Stage colour behind everything (black for the intro). */
	stage: string;
}

export const ATLAS: Theme = { light: "#BFD0FF", mid: "#3D5BFF", deep: "#1B33F0", stage: "#03040a" };

/** Path2D per tile id, built once (the data is static). */
let paths: Map<number, Path2D> | null = null;
const pathOf = (id: number) => {
	paths ??= new Map(MARK.map((m) => [m.id, new Path2D(m.d)]));
	return paths.get(id)!;
};

const TILE_BY_ID = new Map(TILES.map((t) => [t.id, t]));
/** Pieces of the logo that never move: the junction nodes of the globe's grid (tiny dots). Drawn once it is whole. */
const STILL = MARK.filter((m) => !TILE_BY_ID.has(m.id));
/** Per-tile brightness from where it sits on the sphere (static, so computed once). */
const LIGHT = new Map(MARK.map((m) => [m.id, shade(normalAt(m.cx, m.cy))]));

/** Fraction of the short side the globe occupies at rest. */
const MARK_FRACTION = 0.46;
/** The beam fan of the hit: angles (radians) and relative lengths, fixed so the burst is the same every run. */
const BEAMS = Array.from({ length: 28 }, (_, i) => {
	const a = (i / 28) * Math.PI * 2 + (i % 2 ? 0.05 : -0.04);
	const len = 0.55 + 0.45 * (((i * 7919) % 97) / 97);
	return { a, len, w: 0.6 + 1.4 * (((i * 104729) % 89) / 89) };
});

/** Family used for the wordmark; the app loads it lazily (see `loadWordmarkFont`). */
export const WORDMARK_FONT = "Archivo";

/**
 * `w` x `h` are CSS px: the scene is laid out in them under whatever transform the CALLER set (the app sets
 * `setTransform(dpr, 0, 0, dpr, 0, 0)` so a retina buffer is filled; the storyboard uses the identity). `paint` never
 * resets the transform: doing so painted a CSS-sized scene into the top-left quarter of a 2x buffer.
 */
export function paint(
	ctx: CanvasRenderingContext2D,
	f: Frame,
	w: number,
	h: number,
	theme: Theme = ATLAS,
	opts: { shake?: number } = {},
): void {
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;
	ctx.fillStyle = theme.stage;
	ctx.fillRect(0, 0, w, h);

	// The camera: a punch-in and a short shake on the hit, applied to everything on the stage.
	const cam = camera(f.t, opts.shake ?? 1);
	ctx.save();
	ctx.translate(w / 2 + cam.shakeX, h / 2 + cam.shakeY);
	ctx.scale(cam.zoom, cam.zoom);
	ctx.translate(-w / 2, -h / 2);

	const unit = (Math.min(w, h) * MARK_FRACTION) / MARK_VIEW.w;
	const scale = unit * f.markScale * f.push;
	const cx = w / 2;
	const cy = h * 0.44;
	const R = GLOBE.r * scale;

	// Halo: the globe's own light on the stage, rising with the build-up.
	const built =
		f.tiles.reduce((n, t) => n + (t.alpha > 0 && Math.hypot(t.dx, t.dy) < 40 ? 1 : 0), 0) / f.tiles.length;
	if (built > 0) {
		const g = ctx.createRadialGradient(cx, cy, R * 0.6, cx, cy, R * 2.6);
		g.addColorStop(0, `rgba(61,91,255,${0.22 * built * f.markFade})`);
		g.addColorStop(1, "rgba(61,91,255,0)");
		ctx.globalCompositeOperation = "lighter";
		ctx.fillStyle = g;
		ctx.fillRect(0, 0, w, h);
		ctx.globalCompositeOperation = "source-over";
	}

	// The hairline of light before anything arrives: thin, bright, with a soft cross-glow.
	if (f.line > 0) {
		const half = w * 0.2 * f.line;
		const g = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
		g.addColorStop(0, "rgba(191,208,255,0)");
		g.addColorStop(0.5, `rgba(255,255,255,${Math.min(1, f.line * 1.6)})`);
		g.addColorStop(1, "rgba(191,208,255,0)");
		ctx.globalCompositeOperation = "lighter";
		ctx.fillStyle = g;
		ctx.fillRect(cx - half, cy - 1, half * 2, 2);
		const glow = ctx.createLinearGradient(0, cy - 40, 0, cy + 40);
		glow.addColorStop(0, "rgba(61,91,255,0)");
		glow.addColorStop(0.5, `rgba(61,91,255,${0.32 * f.line})`);
		glow.addColorStop(1, "rgba(61,91,255,0)");
		ctx.fillStyle = glow;
		ctx.fillRect(cx - half, cy - 40, half * 2, 80);
		ctx.globalCompositeOperation = "source-over";
	}

	ctx.save();
	ctx.translate(cx, cy);
	ctx.scale(scale, scale);
	ctx.translate(-MARK_VIEW.w / 2, -MARK_VIEW.h / 2);

	const base = ctx.createLinearGradient(40, 20, 390, 410);
	base.addColorStop(0, theme.light);
	base.addColorStop(0.45, theme.mid);
	base.addColorStop(1, theme.deep);

	// Ribbons first, so every trail sits behind every tile: tapered, curved, additive light in the logo's own colours.
	ctx.globalCompositeOperation = "lighter";
	for (const s of f.tiles) {
		if (s.alpha <= 0) continue;
		const tile = TILE_BY_ID.get(s.id)!;
		const pts = ribbon(tile, s, 16);
		if (pts.length < 2) continue;
		const near = 1 + Math.min(1.8, Math.hypot(s.dx, s.dy) / 380);
		// Two passes: a wide soft halo (the bloom of the streak), then a narrower hot core with a white head.
		for (const pass of [
			{ k: 3.2, a: 0.16, white: false },
			{ k: 1.5, a: 0.9, white: true },
		]) {
			for (let i = 0; i < pts.length - 1; i++) {
				const p = pts[i]!;
				const q = pts[i + 1]!;
				ctx.globalAlpha = s.alpha * p.a * pass.a;
				ctx.lineCap = "round";
				ctx.lineWidth = Math.max(0.8, p.w * near * pass.k);
				ctx.strokeStyle = pass.white && i < 5 ? "#ffffff" : i < 9 ? "#cfdcff" : theme.light;
				ctx.beginPath();
				ctx.moveTo(tile.cx + p.x, tile.cy + p.y);
				ctx.lineTo(tile.cx + q.x, tile.cy + q.y);
				ctx.stroke();
			}
		}
	}
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;

	for (const s of f.tiles) {
		if (s.alpha <= 0) continue;
		const lit = LIGHT.get(s.id)!;
		const tile = TILE_BY_ID.get(s.id)!;
		const dist = Math.hypot(s.dx, s.dy);
		// Depth: tiles are nearer the camera while they fly in and grow with it; they shrink to 1 at home.
		const near = 1 + Math.min(1.8, dist / 380);
		ctx.save();
		ctx.translate(tile.cx + s.dx, tile.cy + s.dy);
		ctx.scale(near, near);
		ctx.translate(-tile.cx, -tile.cy);

		// Body: the logo gradient darkened by the lighting of this sheet, brightened while it glows.
		const body = 0.12 + 0.5 * lit.total * (0.35 + 0.65 * Math.min(1, s.glow * 1.6)) + 0.55 * s.glow;
		ctx.globalAlpha = s.alpha;
		ctx.fillStyle = base;
		ctx.fill(pathOf(s.id));
		// Shadow side: multiply-darken the part of the globe facing away from the light.
		ctx.globalCompositeOperation = "source-over";
		ctx.globalAlpha = s.alpha * Math.max(0, 1 - body) * 0.9;
		ctx.fillStyle = "#050824";
		ctx.fill(pathOf(s.id));
		// Light side: additive white-blue on the lit facets, plus the glint.
		ctx.globalCompositeOperation = "lighter";
		ctx.globalAlpha = s.alpha * (0.22 * lit.diffuse + 0.55 * lit.spec + 0.2 * s.glow);
		ctx.fillStyle = "#dfe8ff";
		ctx.fill(pathOf(s.id));
		// Rim: the edge of the globe catches a thin cool light.
		if (lit.rim > 0.08) {
			ctx.globalAlpha = s.alpha * lit.rim * 0.5;
			ctx.lineWidth = (2.4 / scale) * unit * 1.5;
			ctx.strokeStyle = theme.light;
			ctx.stroke(pathOf(s.id));
		}
		// Lit edge on the hit: a bright keyline around the tile as it locks.
		if (s.glow > 0.45) {
			ctx.globalAlpha = s.alpha * (s.glow - 0.45) * 1.4;
			ctx.lineWidth = (2.6 / scale) * unit * 1.5;
			ctx.strokeStyle = "#ffffff";
			ctx.stroke(pathOf(s.id));
		}
		ctx.restore();
	}
	// The junction nodes of the grid appear once the globe is whole.
	if (f.t >= BEATS.hit) {
		ctx.globalCompositeOperation = "lighter";
		ctx.globalAlpha = 0.9;
		ctx.fillStyle = "#ffffff";
		for (const m of STILL) ctx.fill(pathOf(m.id));
	}

	// Specular glint sweeping over the globe, clipped to the tiles so it reads as light travelling across the surface.
	if (f.sweep >= 0 && f.sweep < 1) {
		ctx.save();
		ctx.globalCompositeOperation = "lighter";
		const k = f.sweep;
		const x = GLOBE.cx + (k * 2 - 1) * GLOBE.r * 1.4;
		const g = ctx.createLinearGradient(x - 70, GLOBE.cy - 120, x + 70, GLOBE.cy + 120);
		g.addColorStop(0, "rgba(255,255,255,0)");
		g.addColorStop(0.5, `rgba(235,242,255,${0.7 * Math.sin(Math.PI * k)})`);
		g.addColorStop(1, "rgba(255,255,255,0)");
		ctx.fillStyle = g;
		for (const t of TILES) {
			ctx.save();
			ctx.clip(pathOf(t.id));
			ctx.fillRect(x - 90, 0, 180, MARK_VIEW.h);
			ctx.restore();
		}
		ctx.restore();
	}
	ctx.restore();

	// The hit: crisp radial beams of light and a thin sharp ring, not a soft blob.
	if (f.flash > 0.01) {
		ctx.globalCompositeOperation = "lighter";
		const reach = Math.max(w, h) * 0.75;
		for (const b of BEAMS) {
			const len = reach * b.len * (0.5 + 0.9 * (1 - f.flash) ** 0.5);
			const wid = Math.max(0.8, b.w * 2.6 * f.flash);
			const x1 = cx + Math.cos(b.a) * len;
			const y1 = cy + Math.sin(b.a) * len;
			const g = ctx.createLinearGradient(cx, cy, x1, y1);
			g.addColorStop(0, `rgba(255,255,255,${f.flash})`);
			g.addColorStop(0.18, `rgba(255,255,255,${0.7 * f.flash})`);
			g.addColorStop(0.5, `rgba(150,175,255,${0.4 * f.flash})`);
			g.addColorStop(1, "rgba(61,91,255,0)");
			ctx.strokeStyle = g;
			ctx.lineWidth = wid;
			ctx.beginPath();
			ctx.moveTo(cx + Math.cos(b.a) * R * 0.92, cy + Math.sin(b.a) * R * 0.92);
			ctx.lineTo(x1, y1);
			ctx.stroke();
		}
		// A tight core flash: small, white, bright; the globe itself flares.
		const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.25);
		core.addColorStop(0, `rgba(255,255,255,${0.55 * f.flash})`);
		core.addColorStop(1, "rgba(120,150,255,0)");
		ctx.fillStyle = core;
		ctx.fillRect(cx - R * 1.3, cy - R * 1.3, R * 2.6, R * 2.6);
	}
	if (f.ring > 0 && f.ring < 1) {
		ctx.globalCompositeOperation = "lighter";
		ctx.strokeStyle = `rgba(200,214,255,${0.7 * (1 - f.ring) ** 2})`;
		ctx.lineWidth = 1.2 + 2.2 * (1 - f.ring);
		ctx.beginPath();
		ctx.arc(cx, cy, R * (1.02 + 3.2 * f.ring), 0, Math.PI * 2);
		ctx.stroke();
	}
	ctx.globalCompositeOperation = "source-over";
	ctx.globalAlpha = 1;

	// The wordmark resolving under the globe, from the light of the hit.
	const letters = f.wordmark ? wordmark(f.t) : [];
	if (letters.some((l) => l.alpha > 0.001)) {
		const size = Math.min(w, h) * 0.085;
		ctx.font = `600 ${size}px ${WORDMARK_FONT}, -apple-system, "SF Pro Display", sans-serif`;
		ctx.textBaseline = "alphabetic";
		const widths = [...WORD].map((c) => ctx.measureText(c).width);
		const spread = letters[0]!.spread * size;
		const total = widths.reduce((a, b) => a + b, 0) + spread * (widths.length - 1);
		let x = cx - total / 2;
		const y = cy + R * 1.0 + size * 1.5;
		ctx.globalCompositeOperation = "lighter";
		letters.forEach((l, i) => {
			ctx.globalAlpha = l.alpha;
			ctx.fillStyle = "#dfe8ff";
			ctx.shadowColor = "rgba(90,125,255,0.9)";
			ctx.shadowBlur = size * 0.45;
			ctx.fillText(WORD[i]!, x, y + l.dy * size);
			x += widths[i]! + spread;
		});
		ctx.shadowBlur = 0;
		ctx.globalCompositeOperation = "source-over";
		ctx.globalAlpha = 1;
	}

	// Passing into the mark: it dims as the camera goes through (the live view crossfades to the welcome here).
	if (f.markFade < 1) {
		ctx.fillStyle = `rgba(3,4,10,${(1 - f.markFade) * 0.85})`;
		ctx.fillRect(0, 0, w, h);
	}
	ctx.restore();
}
