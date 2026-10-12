/**
 * Structural CSS of the editor extras (guides, rulers, whitespace marks, bracket colors, status
 * colors). Colors of syntax, selection and chrome live in `lib/cm.ts`; the search panel, sticky
 * header and minimap carry their own `EditorView.theme` next to the code. Everything here goes
 * through CSS variables so every app theme works: `--cm-bracket-1..6`, `--cm-indent-guide*`,
 * `--cm-ruler`, `--cm-whitespace`.
 */
import { EditorView } from "@codemirror/view";

const bracket = (n: number, fallback: string) => `var(--cm-bracket-${n}, ${fallback})`;

export const editorLayoutTheme = EditorView.theme({
	// Bracket pair colors: six steps, falling back to semantic / brand tokens.
	".cm-bracket-0": { color: bracket(1, "var(--ca-brand-main)") },
	".cm-bracket-1": { color: bracket(2, "var(--ca-semantic-warning)") },
	".cm-bracket-2": { color: bracket(3, "var(--ca-semantic-success)") },
	".cm-bracket-3": { color: bracket(4, "var(--ca-semantic-info)") },
	".cm-bracket-4": { color: bracket(5, "var(--ca-semantic-error)") },
	".cm-bracket-5": { color: bracket(6, "var(--ca-text-secondary)") },

	// Indent guides are a line background: no layout impact.
	".cm-indent-guides": { backgroundOrigin: "content-box" },

	// Rulers sit behind the text in a layer.
	".cm-rulers": { pointerEvents: "none" },
	".cm-ruler": {
		background: "var(--cm-ruler, color-mix(in oklab, var(--ca-text-primary) 12%, transparent))",
	},

	// Whitespace: · for a space, → for a tab, drawn with ::before so the text itself is unchanged.
	".cm-ws": { position: "relative" },
	".cm-ws::before": {
		position: "absolute",
		pointerEvents: "none",
		color: "var(--cm-whitespace, color-mix(in oklab, var(--ca-text-primary) 28%, transparent))",
		lineHeight: "inherit",
	},
	".cm-ws-space::before": { content: '"·"', left: 0, width: "100%", textAlign: "center" },
	".cm-ws-tab::before": { content: '"→"', left: 0, width: "100%", textAlign: "left" },

	// Sticky scroll needs the editor box as its positioning context.
	"&": { position: "relative" },
});
