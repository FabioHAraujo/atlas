// Size of the video proxy a camera shot reads from. The viewport (`viewportW` output px) shows source.w / zoom source px,
// so the deepest zoom needs viewportW * zoom proxy px to show one proxy px per output px; more is wasted decode time and
// less upscales. Capped at the source (never upscale the recording itself); even, like every H.264 yuv420p size.

import type { CameraKey } from "./types.ts";

export function cameraProxySize(source: { w: number; h: number }, viewportW: number, keys: CameraKey[]): { w: number; h: number } {
	const deepest = Math.max(1, ...keys.map((k) => k.zoom));
	const w = Math.min(source.w, 2 * Math.ceil((viewportW * deepest) / 2));
	return { w, h: 2 * Math.round((w * source.h) / source.w / 2) };
}
