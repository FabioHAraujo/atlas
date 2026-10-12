/** What the editor hands every rich view. */
export interface RichCtx {
	text: string;
	/** Path relative to the worktree root. */
	path: string;
	worktreeId: string;
	/** Absolute worktree root. */
	root: string;
	/** Switch back to the source (CodeMirror) view, optionally scrolling to a 1-based line. */
	toSource: (line?: number) => void;
	/** Rich views above this size ask before rendering. */
	size: number;
}

/** Soft cap for rich views: above it we offer "Open as source" instead of parsing and rendering everything. */
export const RICH_MAX_BYTES = 1024 * 1024;
