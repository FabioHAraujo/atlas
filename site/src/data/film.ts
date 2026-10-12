// Chapters, duration and the scrub-sprite grid come from the film definition (studio/films/atlas-1-0/film.ts).
// `bun studio publish atlas-1-0` writes public/media/film-chapters.json next to the video; do not edit the values here.
// The helpers below are the pure functions of that data; the player component keeps only state and DOM.
import film from "../../public/media/film-chapters.json";

export const FILM_DURATION: number = film.duration;
export const THUMB: { step: number; w: number; h: number; cols: number } = film.thumb;
export const CHAPTERS: { t: number; title: string }[] = film.chapters;

/** `m:ss`. */
export const fmt = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;

/** Index of the chapter playing at time `t` (-1 before the first). */
export const chapterAt = (t: number) => CHAPTERS.findLastIndex((c) => t >= c.t);

/** Inline style of the scrub-preview tile for time `t`; `k` scales the sprite down on narrow players (128x72 instead of 160x90). */
export const thumbStyle = (sprite: string, t: number, k: number) => {
	const i = Math.min(Math.floor(t / THUMB.step), Math.ceil(FILM_DURATION / THUMB.step) - 1);
	const w = THUMB.w * k, h = THUMB.h * k;
	return `width:${w}px;height:${h}px;background-image:url(${sprite});background-size:${THUMB.cols * w}px auto;background-position:-${(i % THUMB.cols) * w}px -${Math.floor(i / THUMB.cols) * h}px`;
};
