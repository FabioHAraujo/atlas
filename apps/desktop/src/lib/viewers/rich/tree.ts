/** Generic JSON/YAML/TOML value → flat, virtualizable tree rows with copyable paths. */
import { isRecord } from "#lib/viewers/rich/data.ts";

export type ValueType = "string" | "number" | "boolean" | "null" | "object" | "array" | "date";

export interface Row {
	/** Unique id: the JSON path. */
	id: string;
	depth: number;
	key: string;
	/** `a.b[0].c` style path, as people paste it into code. */
	path: string;
	type: ValueType;
	/** Scalar text, or `{n}` / `[n]` for containers. */
	preview: string;
	count: number;
	expandable: boolean;
	expanded: boolean;
	/** Row matches the active search. */
	hit: boolean;
}

export const typeOf = (v: unknown): ValueType =>
	v === null || v === undefined
		? "null"
		: Array.isArray(v)
			? "array"
			: v instanceof Date
				? "date"
				: isRecord(v)
					? "object"
					: (typeof v as ValueType);

const IDENT = /^[A-Za-z_$][\w$]*$/;
const pathKey = (parent: string, key: string | number): string =>
	typeof key === "number"
		? `${parent}[${key}]`
		: IDENT.test(key)
			? parent
				? `${parent}.${key}`
				: key
			: `${parent}[${JSON.stringify(key)}]`;

const preview = (v: unknown, t: ValueType): string =>
	t === "object"
		? `{${Object.keys(v as object).length}}`
		: t === "array"
			? `[${(v as unknown[]).length}]`
			: t === "null"
				? "null"
				: t === "date"
					? (v as Date).toISOString()
					: String(v);

/** Keys of an object/array value in display order. */
const children = (v: unknown): [string | number, unknown][] =>
	Array.isArray(v) ? v.map((x, i) => [i, x]) : isRecord(v) ? Object.entries(v) : [];

/**
 * Rows for every node under `root`, honouring `open` (set of ids). When `query` is set, only nodes that match or
 * have a matching descendant are kept and their ancestors are force-expanded.
 */
export function flatten(
	root: unknown,
	open: ReadonlySet<string>,
	query = "",
): { rows: Row[]; matches: number } {
	const rows: Row[] = [];
	const q = query.trim().toLowerCase();
	let matches = 0;
	const selfHit = (key: string, v: unknown, t: ValueType) =>
		!!q &&
		(key.toLowerCase().includes(q) ||
			(t !== "object" && t !== "array" && preview(v, t).toLowerCase().includes(q)));
	/** Does this subtree contain a hit? (memoised by identity of the walk, cheap enough for capped file sizes) */
	const has = (key: string, v: unknown): boolean => {
		const t = typeOf(v);
		if (selfHit(key, v, t)) return true;
		return children(v).some(([k, c]) => has(String(k), c));
	};
	const walk = (key: string | number, v: unknown, depth: number, parent: string) => {
		const t = typeOf(v);
		const path = depth === 0 ? "" : pathKey(parent, key);
		const id = depth === 0 ? "$" : path;
		const kids = children(v);
		const hit = selfHit(String(key), v, t);
		if (q && depth > 0 && !hit && !has(String(key), v)) return;
		if (hit) matches++;
		const forced = !!q && kids.some(([k, c]) => has(String(k), c));
		const expanded = kids.length > 0 && (open.has(id) || forced);
		rows.push({
			id,
			depth,
			key: depth === 0 ? "root" : String(key),
			path,
			type: t,
			preview: preview(v, t),
			count: kids.length,
			expandable: kids.length > 0,
			expanded,
			hit,
		});
		if (expanded) for (const [k, c] of kids) walk(k, c, depth + 1, path);
	};
	walk("root", root, 0, "");
	return { rows, matches };
}

/** Ids to expand initially: the root and the first level. */
export const defaultOpen = (root: unknown): Set<string> =>
	new Set(["$", ...children(root).map(([k]) => pathKey("", k))]);
