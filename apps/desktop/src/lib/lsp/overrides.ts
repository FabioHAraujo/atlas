/**
 * Per-language server overrides: user settings merged with the project's `.atlas/settings.json`
 * (project wins). Pure; input is untrusted JSON, so every field is type-checked and bad ones dropped.
 */
import type { LspOverride } from "#lib/lsp/types.ts";

const isObject = (v: unknown): v is Record<string, unknown> =>
	typeof v === "object" && v !== null && !Array.isArray(v);

/** Keep only well-typed fields of one override. */
export function cleanOverride(v: unknown): LspOverride {
	if (!isObject(v)) return {};
	const out: LspOverride = {};
	if (typeof v.command === "string" && v.command.trim()) out.command = v.command.trim();
	if (Array.isArray(v.args) && v.args.every((a) => typeof a === "string")) out.args = v.args as string[];
	if (isObject(v.initialization_options)) out.initialization_options = v.initialization_options;
	if (isObject(v.settings)) out.settings = v.settings;
	if (typeof v.disabled === "boolean") out.disabled = v.disabled;
	return out;
}

/** Deep merge of plain objects: `over` wins key by key; arrays and scalars are replaced. */
export function deepMerge(base: Record<string, unknown>, over: Record<string, unknown>) {
	const out: Record<string, unknown> = { ...base };
	for (const [k, v] of Object.entries(over)) {
		const cur = out[k];
		out[k] = isObject(cur) && isObject(v) ? deepMerge(cur, v) : v;
	}
	return out;
}

/**
 * The override for `languageId`: project values replace user values field by field
 * (`initialization_options` and `settings` merge deeply), or `undefined` when neither sets one.
 */
export function mergeLspOverrides(
	user: Record<string, unknown> | undefined,
	project: Record<string, unknown> | undefined,
	languageId: string,
): LspOverride | undefined {
	const u = cleanOverride(user?.[languageId]);
	const p = cleanOverride(project?.[languageId]);
	const merged: LspOverride = { ...u, ...p };
	if (u.initialization_options && p.initialization_options)
		merged.initialization_options = deepMerge(u.initialization_options, p.initialization_options);
	if (u.settings && p.settings) merged.settings = deepMerge(u.settings, p.settings);
	return Object.keys(merged).length ? merged : undefined;
}
