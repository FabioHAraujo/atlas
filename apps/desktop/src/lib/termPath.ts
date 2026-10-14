/** ⌘-click on a file reference in terminal output: the token under the pointer → a worktree file and position. */
import { resolvePath } from "#lib/logs/links.ts";

export interface FileTarget {
	/** Relative to the worktree root. */
	path: string;
	line?: number;
	col?: number;
}

// `path`, `path:line[:col]` or `path(line[,col])`. The path ends in an extension that starts with a letter.
const TOKEN = /^(.+?\.[A-Za-z][A-Za-z0-9]{0,7})(?::(\d+)(?::(\d+))?|\((\d+)(?:,(\d+))?\))?$/;

/**
 * The file a clicked token names, or `null` when it is not a file of this worktree. Relative paths
 * resolve against the terminal's cwd (kept current by OSC 7), else the root; `..` may not leave
 * the worktree. A path needs a `/` or a 2+ letter extension, so `a.b` and `12:34:56` stay text.
 */
export function fileTarget(token: string, cwd: string | null, root: string): FileTarget | null {
	if (token.includes("://") || token.startsWith("~")) return null;
	const m = TOKEN.exec(token);
	if (!m) return null;
	const [, raw, l1, c1, l2, c2] = m;
	const ext = raw.slice(raw.lastIndexOf(".") + 1);
	if (!raw.includes("/") && ext.length < 2) return null;
	const base = cwd && cwd !== root ? relativeTo(cwd, root) : null;
	if (cwd && cwd !== root && base === null) return null;
	const path = resolvePath(raw, root, base);
	if (!path) return null;
	const line = l1 ?? l2;
	const col = c1 ?? c2;
	return { path, line: line ? Number(line) : undefined, col: col ? Number(col) : undefined };
}

/** `cwd` relative to `root`, `""` for the root itself, `null` when it is outside. */
function relativeTo(cwd: string, root: string): string | null {
	const r = root.replace(/\/+$/, "");
	const c = cwd.replace(/\/+$/, "");
	if (c === r) return "";
	return c.startsWith(`${r}/`) ? c.slice(r.length + 1) : null;
}
