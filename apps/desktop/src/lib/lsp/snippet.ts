/**
 * LSP snippet syntax -> CodeMirror's `snippet()` template syntax.
 *
 * LSP: `$1`, `${1:default}` (defaults may nest), `${1|a,b|}` choice, `$0` final stop, `$VAR` /
 * `${VAR:default}` variables, `\$ \} \\` escapes. CodeMirror (`Snippet.parse`): `${1:default}` /
 * `${}` fields (same number = same field, mirrored; `${0}` is the final position), no nesting, and
 * the only escapes are `\{` and `\}`: a literal `{`/`}` is written `\{`/`\}`, which also defuses a
 * literal `${`/`#{` (it becomes `$\{`).
 */

const VAR_DEFAULTS: Record<string, string> = {
	TM_FILENAME: "",
	TM_FILENAME_BASE: "",
	TM_DIRECTORY: "",
	TM_FILEPATH: "",
	CLIPBOARD: "",
	CURRENT_YEAR: "",
};

/** Escape text so CodeMirror's template parser keeps it literal. */
const lit = (s: string) => s.replace(/[{}]/g, (c) => `\\${c}`);

interface Parsed {
	/** Template for `snippet()`. */
	template: string;
	/** True when the snippet has no tab stops (a plain insert is enough). */
	plain: boolean;
}

export function lspSnippetToCm(src: string): Parsed {
	let i = 0;
	let plain = true;
	let hasFinal = false;

	/** Parse until an unescaped `}` (when `nested`) or the end; returns the CodeMirror form. */
	function body(nested: boolean, choice = false): string {
		const flat = nested || choice;
		let out = "";
		while (i < src.length) {
			const c = src[i];
			if (c === "\\" && i + 1 < src.length && /[\\${}|,]/.test(src[i + 1])) {
				out += lit(src[i + 1]);
				i += 2;
			} else if (nested && c === "}") {
				return out;
			} else if (choice && (c === "|" || c === ",")) {
				return out;
			} else if (c === "$") {
				out += dollar(flat);
			} else {
				out += lit(c);
				i++;
			}
		}
		return out;
	}

	function dollar(flat: boolean): string {
		i++; // $
		const m = /^(\d+)|^([A-Za-z_]\w*)/.exec(src.slice(i));
		if (m) {
			i += m[0].length;
			return m[1] !== undefined ? tabstop(m[1], "", flat) : (VAR_DEFAULTS[m[2]] ?? "");
		}
		if (src[i] !== "{") return "$";
		i++; // {
		const n = /^(\d+)/.exec(src.slice(i));
		const v = /^([A-Za-z_]\w*)/.exec(src.slice(i));
		if (n) {
			i += n[1].length;
			if (src[i] === ":") {
				i++;
				const def = body(true);
				i++; // }
				return tabstop(n[1], def, flat);
			}
			if (src[i] === "|") {
				i++;
				const first = body(false, true);
				while (i < src.length && src[i] !== "}") i++; // skip remaining choices
				i++;
				return tabstop(n[1], first, flat);
			}
			i++; // }
			return tabstop(n[1], "", flat);
		}
		if (v) {
			i += v[1].length;
			let def = "";
			if (src[i] === ":") {
				i++;
				def = body(true);
			}
			i++; // }
			return def || (VAR_DEFAULTS[v[1]] ?? "");
		}
		return "$";
	}

	function tabstop(num: string, def: string, flat: boolean): string {
		if (flat) return def;
		if (num === "0") {
			hasFinal = true;
			return "${0}";
		}
		plain = false;
		return def ? `\${${num}:${def}}` : `\${${num}}`;
	}

	const template = body(false);
	// A `$0` only marks where the caret ends; CodeMirror's trailing empty field does that too.
	return { template, plain: plain && !hasFinal };
}
