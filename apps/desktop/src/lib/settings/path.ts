/** Path helper for opening files that live outside the worktree. */

/**
 * Path of `target` relative to `root` (both absolute, no trailing slash), using `..` to climb out.
 * Editor tabs take worktree-relative paths, so this lets one open a file outside the worktree.
 */
export function relativeFrom(root: string, target: string): string {
	const a = root.split("/").filter(Boolean);
	const b = target.split("/").filter(Boolean);
	let i = 0;
	while (i < a.length && i < b.length && a[i] === b[i]) i++;
	return [...Array<string>(a.length - i).fill(".."), ...b.slice(i)].join("/");
}
