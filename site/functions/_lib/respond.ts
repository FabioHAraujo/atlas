import { CHANNELS, isChannel, type Channel } from "./channels";
import { CACHE_CONTROL } from "./edge";

/** Cache headers for every edge answer. `stale` answers are short-lived so the next request retries GitHub. */
export const edgeHeaders = (extra: HeadersInit = {}, stale = false): Headers => {
	const h = new Headers(extra);
	h.set("cache-control", stale ? "public, max-age=15, stale-while-revalidate=60" : CACHE_CONTROL);
	h.set("x-atlas-source", stale ? "stale-last-good" : "github-latest");
	return h;
};

export const wantsFresh = (url: string) => new URL(url).searchParams.get("fresh") === "1";

/** `?channel=` (default stable). `null` when the name is not a channel: answer with `badChannel()`. */
export function wantedChannel(url: string): Channel | null {
	const c = new URL(url).searchParams.get("channel");
	if (c === null) return "stable";
	return isChannel(c) ? c : null;
}

export const badChannel = () => Response.json({ error: "invalid_channel", valid: CHANNELS }, { status: 400, headers: { "cache-control": "no-store", "access-control-allow-origin": "*" } });
