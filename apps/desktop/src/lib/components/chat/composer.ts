/** Pure chat-composer rules: slash-command and @file suggestions, prompt history, tool-call summaries. */

const SUGGEST_MAX = 8;
export const HISTORY_MAX = 50;

/** Slash commands matching a draft that is just `/prefix` (no space yet). */
export function slashHits<C extends { name: string }>(draft: string, commands: C[]): C[] {
	if (!draft.startsWith("/") || draft.includes(" ")) return [];
	return commands.filter((c) => c.name.startsWith(draft.slice(1))).slice(0, SUGGEST_MAX);
}

/** The `@partial` file mention at the end of the draft, or `undefined` when there is none. */
const atQuery = (draft: string) => draft.match(/(?:^|\s)@([^\s]*)$/)?.[1];

/** Files matching the trailing `@mention`. */
export function atHits(draft: string, files: string[]): string[] {
	const q = atQuery(draft);
	return q === undefined ? [] : files.filter((f) => f.includes(q)).slice(0, SUGGEST_MAX);
}

/** The draft with its trailing `@partial` replaced by the chosen file. */
export const completeAt = (draft: string, file: string) => draft.replace(/@[^\s]*$/, `@${file} `);

/** `history` with `msg` first and any earlier copy removed, capped at `HISTORY_MAX`. */
export const pushHistory = (history: string[], msg: string) =>
	[msg, ...history.filter((h) => h !== msg)].slice(0, HISTORY_MAX);

/** One-line summary of a tool call's arguments for its collapsed header. */
export function argsLine(a: unknown): string {
	if (!a || typeof a !== "object") return "";
	const o = a as Record<string, unknown>;
	const q = Array.isArray(o.questions)
		? (o.questions[0] as Record<string, unknown> | undefined)?.question
		: undefined;
	return String(o.command ?? o.path ?? o.pattern ?? o.query ?? q ?? JSON.stringify(a)).slice(0, 160);
}
