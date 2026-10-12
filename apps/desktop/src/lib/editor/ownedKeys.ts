/**
 * Chords a focused text editor keeps for editing even though the shell binds them: the window
 * dispatcher (`shell/windowKeys.ts`) runs in the capture phase, so without this CodeMirror never
 * sees them. Only these exact chords yield; every other shell shortcut (⌘S, ⌘P, ⌘W, …) still wins
 * inside an editor. The shell commands stay reachable from the palette, the menu and when the
 * focus is outside an editor.
 *
 * Strokes use the keymap's canonical spelling (`cmd-[`, modifiers in `ctrl-alt-shift-cmd` order, see lib/keys.ts `strokeOf`).
 */
import { strokeOf } from "#lib/keys.ts";

/** Stroke → what the editor does with it (documentation and tests; the set is what matters). */
export const EDITOR_OWNED: Readonly<Record<string, string>> = {
	"cmd-[": "Outdent line (shell: Back)",
	"cmd-]": "Indent line (shell: Forward)",
	"cmd-/": "Toggle line comment (shell: Help)",
	"cmd-l": "Select line (shell: Logs)",
	"shift-cmd-\\": "Jump to matching bracket (shell: Split down)",
};

/** Is `e` a chord the focused editor owns? `target` is where the key goes (the focused element). */
export function editorOwnsKey(e: KeyboardEvent, target: EventTarget | null = e.target): boolean {
	if (!(target instanceof Element) || !target.closest(".cm-editor")) return false;
	const stroke = strokeOf(e);
	return stroke !== null && Object.hasOwn(EDITOR_OWNED, stroke);
}
