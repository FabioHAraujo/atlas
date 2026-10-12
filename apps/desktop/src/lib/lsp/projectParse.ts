/** Pure parse of `.atlas/settings.json` (see `projectSettings.ts`): never throws. */

export interface ProjectLsp {
	lsp: Record<string, unknown>;
	/** One line for the user when the file exists but cannot be used. */
	warning?: string;
}

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

const IGNORED = "Language overrides from it are ignored.";

export function parseProjectSettings(text: string): ProjectLsp {
	let json: unknown;
	try {
		json = JSON.parse(text);
	} catch (e) {
		const why = e instanceof Error ? e.message : "invalid JSON";
		return { lsp: {}, warning: `.atlas/settings.json is not valid JSON (${why}). ${IGNORED}` };
	}
	if (!isObject(json)) return { lsp: {}, warning: `.atlas/settings.json must be a JSON object. ${IGNORED}` };
	if (json.lsp === undefined) return { lsp: {} };
	if (!isObject(json.lsp))
		return {
			lsp: {},
			warning: 'In .atlas/settings.json, "lsp" must be an object keyed by language. It is ignored.',
		};
	return { lsp: json.lsp };
}
