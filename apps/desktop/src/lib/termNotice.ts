/** Desktop notifications a terminal program asks for (OSC 9, OSC 777;notify). Pure: the agents store feeds it live state. */

/** Payload of `term://notify` (serialized from the Rust `VtEvent::Notify`). */
export interface TermNotice {
	title: string | null;
	body: string;
}

const BODY_MAX = 120;

/** Banner text: the program's title, else `worktree · terminal`; the body as one capped line. */
export function noticeText(n: TermNotice, worktree: string | undefined) {
	const title = n.title ?? (worktree ? `${worktree} · terminal` : "Terminal");
	return { title, body: n.body.replace(/\s+/g, " ").trim().slice(0, BODY_MAX) };
}

/** A notice is for someone looking elsewhere; `suppressWhenFocused: false` shows it anyway (same switch as agent status). */
export function shouldNotify(
	s: { enabled: boolean; suppressWhenFocused: boolean },
	at: { windowFocused: boolean; tabVisible: boolean },
): boolean {
	if (!s.enabled) return false;
	return !at.windowFocused || !at.tabVisible || !s.suppressWhenFocused;
}
