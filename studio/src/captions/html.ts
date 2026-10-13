// Burned captions as host-composition HTML, and the sidecar record the lint reads.

import type { CaptionCue } from "../camera/types.ts";
import { lineSeconds } from "../audio/voice.ts";
import type { Cut, Film } from "../lib/types.ts";
import { profileFor, profileForAspect } from "../lint/profiles.ts";
import { type CaptionLayout, layoutCaptions } from "./layout.ts";
import { CAPTION_STYLES, type CaptionStyleId } from "./styles.ts";

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const num = (n: number): number => +n.toFixed(4);

/**
 * One `.clip` per cue, the attribute contract compile.ts always used: id `cap<i>`, `data-start`, `data-duration`,
 * `data-track-index="4"`. The element is the rect of the block (absolute, output px) so the picture and the lint's
 * `captions` sidecar describe the same pixels; `white-space: pre` keeps the line breaks the layout measured.
 */
export function captionsHtml(cues: CaptionCue[], styleId: CaptionStyleId): string {
	const style = CAPTION_STYLES[styleId];
	return cues
		.map((c, i) => {
			const r = c.rect;
			const pill = style.pill;
			const css = [
				"position:absolute",
				`left:${r.x}px`,
				`top:${r.y}px`,
				`width:${r.w}px`,
				`height:${r.h}px`,
				"box-sizing:border-box",
				"display:flex",
				"flex-direction:column",
				"align-items:center",
				"justify-content:center",
				"text-align:center",
				"white-space:pre",
				"color:#fff",
				`font:${style.weight} ${c.fontPx}px/${style.lineHeight} var(--font)`,
				style.uppercase ? "text-transform:uppercase" : "",
				style.shadow === "none" ? "" : `text-shadow:${style.shadow}`,
				style.strokeEm ? `-webkit-text-stroke:${style.strokeEm}em #000;paint-order:stroke fill` : "",
				pill ? `background:${pill.background};border-radius:${pill.radius}px;padding:${pill.padY}px ${pill.padX}px` : "",
			]
				.filter(Boolean)
				.join(";");
			const text = c.lines.map(esc).join("\n");
			return `<div id="cap${i}" class="clip" data-start="${num(c.start)}" data-duration="${num(c.end - c.start)}" data-track-index="4" style="${css}">${text}</div>`;
		})
		.join("\n");
}

/** The cues as the sidecar stores them (`CameraSidecar.captions`): plain data, no HTML. */
export const captionSidecar = (cues: CaptionLayout["cues"]): CaptionCue[] => cues.map((c) => ({ ...c, lines: [...c.lines], rect: { ...c.rect } }));

/**
 * Everything compile needs for a cut's burned captions: the speech seconds of each line from the voice cache (offline,
 * the same measure `mix.ts` uses), the layout against the cut's profile and the HTML. Throws nothing for problems: they
 * are returned so the caller (compile/check) can fail with the full list instead of the first.
 */
export async function burnedCaptionsFor(film: Film, cut: Cut): Promise<{ html: string; layout: CaptionLayout }> {
	const voice = cut.voice!;
	const seconds: Record<string, number> = {};
	for (const l of voice.lines) seconds[l.id] = await lineSeconds(voice, l, { offline: true });
	const profile = profileFor(profileForAspect(cut.aspect));
	const layout = layoutCaptions(cut, film, profile, cut.aspect, seconds);
	return { html: captionsHtml(layout.cues, layout.style), layout };
}
