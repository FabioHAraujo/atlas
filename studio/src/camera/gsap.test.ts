import { describe, expect, test } from "bun:test";
import { cameraJs, cameraTransform } from "./gsap.ts";
import { planCamera, poseAt } from "./plan.ts";
import { DEFAULT_LIMITS, type Frame, type ResolvedFocus } from "./types.ts";

const frame: Frame = { source: { w: 2560, h: 1576 }, viewport: { x: 0, y: 450, w: 1080, h: 790 }, frame: { w: 1080, h: 1920 }, scale: 2 };
const legible = { minTextPx: 18, displayHeight: 844 };
const f = (id: string, at: number, x: number, y: number): ResolvedFocus => ({ id, at, rect: { x, y, w: 360, h: 60 }, via: "ocr", textPx: 30 });
const cam = planCamera(frame, legible, DEFAULT_LIMITS, [f("a", 1, 500, 500), f("b", 4, 1400, 900)], 8);
const proxy = { w: 2560, h: 1576 };

// The camera element is the video's wrapper: `transform-origin: 0 0`, so the transform of pose p is
//   scale = fit * zoom;  x = viewport.w/2 - p.x * scale;  y = viewport.h/2 - p.y * scale   (output px, relative to the viewport)
describe("cameraTransform: pose -> the CSS transform that puts the pose's center in the middle of the viewport", () => {
	test("the source point at the pose center lands exactly at the viewport center", () => {
		const t = cameraTransform(frame, proxy, { x: 900, y: 700, zoom: 2 });
		const s = t.scale * (proxy.w / frame.source.w);
		expect(t.x + 900 * s).toBeCloseTo(frame.viewport.w / 2, 6);
		expect(t.y + 700 * s).toBeCloseTo(frame.viewport.h / 2, 6);
	});

	test("zoom 1 on a clamped pose shows the whole window width", () => {
		const t = cameraTransform(frame, proxy, { x: 1280, y: 788, zoom: 1 });
		expect(t.scale * proxy.w).toBeCloseTo(frame.viewport.w, 6);
	});

	test("a half-size proxy gives the same picture: the transform compensates for the proxy's resolution", () => {
		const half = { w: 1280, h: 788 };
		const a = cameraTransform(frame, proxy, { x: 900, y: 700, zoom: 2 });
		const b = cameraTransform(frame, half, { x: 900, y: 700, zoom: 2 });
		expect(b.scale).toBeCloseTo(a.scale * 2, 9);
		expect(b.x).toBeCloseTo(a.x, 6);
	});
});

describe("cameraJs: a frame-exact track", () => {
	const js = cameraJs(cam.keys, frame, proxy, 8, 30, "#cam");

	test("emits one tween per frame while the camera moves and a single tween for each hold", () => {
		const tweens = js.split("\n").filter((l) => l.startsWith("tl."));
		const moving = Math.ceil(cam.keys.slice(1).reduce((n, k) => n + k.move, 0) * 30);
		expect(tweens.length).toBeGreaterThan(moving / 2);
		expect(tweens.length).toBeLessThan(8 * 30); // not a tween per frame for a still camera
	});

	test("never uses a non-linear ease: the path is sampled, so the render equals the planner's poseAt at every frame", () => {
		expect(js).not.toMatch(/ease:"(?!none)/);
	});

	test("the set at t=0 is the establishing pose", () => {
		const t0 = cameraTransform(frame, proxy, poseAt(cam.keys, 0));
		expect(js).toContain(`x:${+t0.x.toFixed(3)}`);
	});

	test("a camera without motion is one set, no tweens", () => {
		const still = planCamera(frame, legible, DEFAULT_LIMITS, [], 5);
		const out = cameraJs(still.keys, frame, proxy, 5, 30, "#cam");
		expect(out.split("\n").filter((l) => l.startsWith("tl.to"))).toHaveLength(0);
		expect(out).toContain("tl.set");
	});

	test("a cut is a set at the arrival time, not a tween", () => {
		const far = planCamera(frame, legible, DEFAULT_LIMITS, [f("a", 1, 100, 100), f("b", 4, 2400, 1500)], 8);
		const out = cameraJs(far.keys, frame, proxy, 8, 30, "#cam");
		const arrive = far.keys.find((k) => k.focus === "b")!;
		expect(arrive.ease).toBe("cut");
		expect(out).toContain(`},${+arrive.t.toFixed(4)});`);
		expect(out.match(/tl\.set/g)!.length).toBeGreaterThanOrEqual(2);
	});

	test("deterministic: the same keys give byte-identical output", () => {
		expect(cameraJs(cam.keys, frame, proxy, 8, 30, "#cam")).toBe(js);
	});
});
