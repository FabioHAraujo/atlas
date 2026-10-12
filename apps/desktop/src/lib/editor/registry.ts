/** Which `EditorSession` drives which CodeMirror view, so commands outside the component can reach it. */
import type { EditorView } from "@codemirror/view";
import type { EditorSession } from "#lib/editor/EditorSession.svelte.ts";

const sessions = new WeakMap<EditorView, EditorSession>();

export const registerSession = (view: EditorView, s: EditorSession) => void sessions.set(view, s);
export const sessionOf = (view: EditorView): EditorSession | undefined => sessions.get(view);
