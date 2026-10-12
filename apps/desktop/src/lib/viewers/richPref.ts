/**
 * Rich ("eye") view choice, remembered per file type (`fileType().id`), not per file: switching one
 * Dockerfile to source makes the next Dockerfile open as source too, like an editor setting.
 */
import { RICH_DEFAULT_VIEWS, type FileType } from "#lib/viewers/fileType.ts";

const KEY = "atlas.richView";

/** Types whose rendered view is the default; the rest open as source until the user toggles them. */
export const richByDefault = (t: FileType): boolean => !!t.view && RICH_DEFAULT_VIEWS[t.view];

interface Store {
	getItem(k: string): string | null;
	setItem(k: string, v: string): void;
}

const read = (s: Store): Record<string, boolean> => {
	try {
		const v: unknown = JSON.parse(s.getItem(KEY) ?? "{}");
		return v && typeof v === "object" ? (v as Record<string, boolean>) : {};
	} catch {
		return {};
	}
};

/** Whether this file type should open in its rich view. */
export function wantsRich(t: FileType, s: Store = localStorage): boolean {
	if (!t.view) return false;
	return read(s)[t.id] ?? richByDefault(t);
}

export function rememberRich(t: FileType, on: boolean, s: Store = localStorage): void {
	s.setItem(KEY, JSON.stringify({ ...read(s), [t.id]: on }));
}
