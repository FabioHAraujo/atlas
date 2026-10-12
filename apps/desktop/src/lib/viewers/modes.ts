/** Line-based CodeMirror stream modes for dev files that no bundled grammar covers. */
import type { StreamParser } from "@codemirror/language";

/** `.env`: `# comment`, `export KEY=value`, quoted values, `${VAR}` expansions. */
export const envMode: StreamParser<{ inValue: boolean; quote: string }> = {
	startState: () => ({ inValue: false, quote: "" }),
	token(stream, state) {
		if (state.quote) {
			while (!stream.eol()) {
				const ch = stream.next();
				if (ch === "\\" && state.quote === '"') stream.next();
				else if (ch === state.quote) {
					state.quote = "";
					return "string";
				}
			}
			return "string";
		}
		if (stream.sol()) {
			state.inValue = false;
			stream.eatSpace();
			if (stream.peek() === "#") {
				stream.skipToEnd();
				return "comment";
			}
			if (stream.match(/^export(?=\s)/)) return "keyword";
		}
		if (!state.inValue) {
			if (stream.match(/^[A-Za-z_][A-Za-z0-9_.-]*/)) return "propertyName";
			if (stream.eat("=")) {
				state.inValue = true;
				return "operator";
			}
			stream.next();
			return null;
		}
		if (stream.eatSpace()) return null;
		const ch = stream.peek();
		if (ch === '"' || ch === "'") {
			state.quote = ch;
			stream.next();
			return "string";
		}
		if (stream.match(/^\$\{[^}]*\}|^\$[A-Za-z_][A-Za-z0-9_]*/)) return "variableName";
		if (stream.match(/^#.*/)) return "comment";
		if (stream.match(/^(true|false)(?=\s|$)/i)) return "bool";
		if (stream.match(/^-?\d+(\.\d+)?(?=\s|$)/)) return "number";
		stream.next();
		return "string";
	},
	languageData: { commentTokens: { line: "#" } },
};

/** `.gitignore`-family: comments, negation, globs, trailing slash. */
export const gitignoreMode: StreamParser<unknown> = {
	token(stream) {
		if (stream.sol()) {
			if (stream.match(/^\s*#.*/)) return "comment";
			if (stream.eat("!")) return "keyword";
		}
		if (stream.match(/^\*\*|^[*?]|^\[[^\]]*\]/)) return "operator";
		if (stream.match(/^\/$|^\/(?=\s*$)/)) return "punctuation";
		if (stream.eat("/")) return "punctuation";
		stream.match(/^[^*?[/\s]+/) || stream.next();
		return "string";
	},
	languageData: { commentTokens: { line: "#" } },
};

/** Makefile: targets, variables, directives, `$(…)` expansions, tab-indented recipes. */
export const makefileMode: StreamParser<{ recipe: boolean }> = {
	startState: () => ({ recipe: false }),
	token(stream, state) {
		if (stream.sol()) {
			state.recipe = stream.peek() === "\t";
			if (!state.recipe && stream.match(/^\s*#.*/)) return "comment";
			if (state.recipe) {
				stream.next();
				return null;
			}
			if (
				stream.match(
					/^(ifn?eq|ifn?def|else|endif|include|-include|sinclude|define|endef|export|unexport|override|vpath)\b/,
				)
			)
				return "keyword";
			if (stream.match(/^\.[A-Z_]+(?=\s*:)/)) return "keyword";
			if (stream.match(/^[^\s:=#$]+(?=\s*(:[^=]|:$))/)) return "labelName";
			if (stream.match(/^[A-Za-z_][A-Za-z0-9_.-]*(?=\s*[:+?!]?=)/)) return "variableName";
		}
		if (stream.match(/^\$[({][^)}]*[)}]|^\$[@<^?*%+|]|^\$\$/)) return "variableName";
		if (stream.match(/^#.*/) && !state.recipe) return "comment";
		if (state.recipe && stream.match(/^#.*/)) return "comment";
		if (stream.match(/^"([^"\\]|\\.)*"|^'[^']*'/)) return "string";
		if (stream.match(/^[:?+!]?=|^::|^:/)) return "operator";
		stream.next();
		return null;
	},
	languageData: { commentTokens: { line: "#" } },
};

/** Justfile: recipes, `set`/`alias`/`import`, `{{ }}` interpolation, `[attributes]`. */
export const justfileMode: StreamParser<{ recipe: boolean }> = {
	startState: () => ({ recipe: false }),
	token(stream, state) {
		if (stream.sol()) {
			state.recipe = /^[ \t]/.test(stream.string);
			if (state.recipe) {
				stream.eatSpace();
				return null;
			}
			if (stream.match(/^\s*#.*/)) return "comment";
			if (stream.match(/^\[[^\]]*\]/)) return "meta";
			if (stream.match(/^(set|alias|import|mod|export)\b/)) return "keyword";
			if (stream.match(/^@?[A-Za-z_][A-Za-z0-9_-]*(?=[^:=\n]*:(?!=))/)) return "labelName";
			if (stream.match(/^[A-Za-z_][A-Za-z0-9_-]*(?=\s*:?=)/)) return "variableName";
		}
		if (stream.match(/^\{\{[^}]*\}\}/)) return "variableName";
		if (stream.match(/^#.*/)) return "comment";
		if (stream.match(/^"([^"\\]|\\.)*"|^'[^']*'|^`[^`]*`/)) return "string";
		if (stream.match(/^:?=|^:/)) return "operator";
		stream.next();
		return null;
	},
	languageData: { commentTokens: { line: "#" } },
};

/** Procfile: `name: command`. */
export const procfileMode: StreamParser<unknown> = {
	token(stream) {
		if (stream.sol()) {
			if (stream.match(/^\s*#.*/)) return "comment";
			if (stream.match(/^[A-Za-z0-9_-]+(?=\s*:)/)) return "labelName";
		}
		if (stream.eat(":")) return "operator";
		if (stream.match(/^\$[A-Za-z_][A-Za-z0-9_]*|^\$\{[^}]*\}/)) return "variableName";
		if (stream.match(/^"([^"\\]|\\.)*"|^'[^']*'/)) return "string";
		stream.next();
		return null;
	},
};

/** Plain logs: timestamps, levels, brackets. */
export const logMode: StreamParser<unknown> = {
	token(stream) {
		if (
			stream.match(
				/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?|^\d{2}:\d{2}:\d{2}(\.\d+)?/,
			)
		)
			return "number";
		if (stream.match(/^(ERROR|FATAL|CRITICAL|PANIC|FAIL(ED)?)\b/i)) return "invalid";
		if (stream.match(/^(WARN(ING)?)\b/i)) return "atom";
		if (stream.match(/^(INFO|DEBUG|TRACE|NOTICE)\b/i)) return "keyword";
		if (stream.match(/^\[[^\]]*\]/)) return "labelName";
		if (stream.match(/^"([^"\\]|\\.)*"/)) return "string";
		if (stream.match(/^https?:\/\/\S+/)) return "link";
		stream.next();
		return null;
	},
};
