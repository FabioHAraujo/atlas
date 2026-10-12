/** Link detection in log text (URLs, `file:line:col`) and resolving file references against a worktree. */

export interface LinkSpan {
	start: number;
	end: number;
	kind: "url" | "file";
	/** URL, or the file path as written. */
	target: string;
	line?: number;
	col?: number;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"'`)\]}]+/g;
// `path:line[:col]` or `path(line,col)`; the path needs a slash or a known extension to avoid
// matching `12:34:56` timestamps and `key:value` pairs.
const FILE_RE =
	/(?<![\w@/.:-])((?:\.{0,2}\/|[A-Za-z]:[\\/])?(?:[\w@.~+-]+\/)*[\w@.+-]+\.[A-Za-z][A-Za-z0-9]{0,7})(?::(\d+)(?::(\d+))?|\((\d+)(?:,(\d+))?\))/g;
const TRAIL = /[.,;:!?]+$/;

/** URLs and `file:line[:col]` references in `text`, ordered, non-overlapping. */
export function findLinks(text: string): LinkSpan[] {
	if (!text.includes("/") && !text.includes(".")) return [];
	const out: LinkSpan[] = [];
	if (text.includes("://")) {
		URL_RE.lastIndex = 0;
		for (let m = URL_RE.exec(text); m; m = URL_RE.exec(text)) {
			const target = m[0].replace(TRAIL, "");
			out.push({ start: m.index, end: m.index + target.length, kind: "url", target });
		}
	}
	FILE_RE.lastIndex = 0;
	for (let m = FILE_RE.exec(text); m; m = FILE_RE.exec(text)) {
		const start = m.index;
		const end = start + m[0].length;
		if (out.some((u) => start < u.end && end > u.start)) continue;
		out.push({
			start,
			end,
			kind: "file",
			target: m[1],
			line: Number(m[2] ?? m[4]),
			col: (m[3] ?? m[5]) ? Number(m[3] ?? m[5]) : undefined,
		});
	}
	return out.sort((a, b) => a.start - b.start);
}

/**
 * Worktree-relative path for a file reference, or `null` when it points outside
 * `root`. Relative paths resolve against `serviceDir` (relative to the root) first.
 */
export function resolvePath(target: string, root: string, serviceDir?: string | null): string | null {
	const r = root.replace(/\/+$/, "");
	let abs: string;
	if (target.startsWith("/")) abs = target;
	else if (/^[A-Za-z]:[\\/]/.test(target)) return null;
	else abs = `${r}/${serviceDir ? `${serviceDir.replace(/^\.?\/|\/+$/g, "")}/` : ""}${target}`;
	const parts: string[] = [];
	for (const seg of abs.split("/")) {
		if (seg === "..") parts.pop();
		else if (seg && seg !== ".") parts.push(seg);
	}
	const norm = `/${parts.join("/")}`;
	if (norm !== r && !norm.startsWith(`${r}/`)) return null;
	return norm.slice(r.length + 1) || null;
}
