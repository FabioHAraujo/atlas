import { sanitizeRulers } from "#lib/prefs.ts";

/** "80, 100" or "80 100" → [80, 100]. Words that are not whole columns are dropped by `sanitizeRulers`. */
export function parseRulers(text: string): number[] {
	return sanitizeRulers(
		text
			.split(/[\s,]+/)
			.filter((w) => w !== "")
			.map(Number),
	);
}

export const formatRulers = (cols: readonly number[]): string => cols.join(", ");
