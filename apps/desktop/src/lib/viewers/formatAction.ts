/** "Format document": the language server when it can, else the built-in formatter (JSON, Prettier for web formats). */
import { toast } from "@codeatlasdev/ui";
import { indentUnit } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";
import { host, b64bytes } from "#lib/host.ts";
import { formatDocument } from "#lib/lsp/actions.ts";
import { editorFiles } from "#lib/symbols.ts";
import { fileType } from "#lib/viewers/fileType.ts";
import { canFormat, editorConfigFor, formatText } from "#lib/viewers/format.ts";

/** `.editorconfig` files from the worktree root down to the file's directory (root first, closest last). */
async function editorConfigs(root: string, path: string): Promise<{ dir: string; text: string }[]> {
	const parts = path.split("/").slice(0, -1);
	const dirs = ["", ...parts.map((_, i) => parts.slice(0, i + 1).join("/"))];
	const found = await Promise.all(
		dirs.map(async (dir) => {
			try {
				const r = await host.fsRead(`${root}/${dir ? dir + "/" : ""}.editorconfig`, 64 * 1024);
				return { dir, text: new TextDecoder().decode(b64bytes(r.data)) };
			} catch {
				return null;
			}
		}),
	);
	return found.filter((f): f is { dir: string; text: string } => f !== null);
}

/** Server first; the built-in formatter when there is no server or it has no formatter. Returns whether anything formatted. */
export async function formatActive(view: EditorView): Promise<boolean> {
	if (await formatDocument(view, true)) return true;
	const file = editorFiles.get(view);
	const lang = file ? fileType(file.path).lang : null;
	if (!file || !canFormat(lang)) {
		toast.info("No formatter for this file");
		return false;
	}
	const ec = editorConfigFor(await editorConfigs(file.root, file.path), file.path);
	const unit = view.state.facet(indentUnit);
	const text = view.state.doc.toString();
	try {
		const out = await formatText(text, lang, {
			indent: ec.indent ?? (unit.startsWith("\t") ? "\t" : unit),
			finalNewline: ec.finalNewline ?? true,
		});
		if (out === null) return false;
		// The buffer may have changed while Prettier loaded: never overwrite newer edits.
		if (view.state.doc.toString() !== text) return false;
		if (out !== text)
			view.dispatch({ changes: { from: 0, to: text.length, insert: out }, userEvent: "input.format" });
		else toast.info("Already formatted");
		return true;
	} catch (e) {
		toast.error(`Cannot format: ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
		return false;
	}
}
