/** Syntax-highlight a snippet by `fileType().lang` id, loading the grammar lazily. */
import { highlightCode } from "@lezer/highlight";
import { LanguageSupport, StreamLanguage, type Language } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { highlight } from "#lib/cm.ts";
import { loadLanguage } from "#lib/viewers/lang.ts";

const esc = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The Language inside a loaded extension (LanguageSupport, StreamLanguage or a nested array of them). */
function languageIn(ext: Extension): Language | null {
	if (ext instanceof StreamLanguage) return ext;
	if (ext instanceof LanguageSupport) return ext.language;
	if (Array.isArray(ext)) {
		for (const e of ext) {
			const l = languageIn(e);
			if (l) return l;
		}
	}
	return null;
}

/** Highlighted HTML (spans with the editor's classes) for `code`; plain escaped text when the language is unknown. */
export async function highlightLang(code: string, lang: string | null): Promise<string> {
	const language = languageIn(await loadLanguage(lang));
	if (!language) return esc(code);
	let out = "";
	highlightCode(
		code,
		language.parser.parse(code),
		highlight,
		(text, classes) => {
			out += classes ? `<span class="${classes}">${esc(text)}</span>` : esc(text);
		},
		() => (out += "\n"),
	);
	return out;
}
