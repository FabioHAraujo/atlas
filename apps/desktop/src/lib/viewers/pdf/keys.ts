/** Keyboard → PDF viewer action mapping (pure; the viewer performs the action). */

export type KeyAction =
	| { type: "zoom"; to: "in" | "out" | "width" | 1 }
	| { type: "find" }
	| { type: "match"; dir: 1 | -1 }
	| { type: "scroll"; dy: number }
	| { type: "home" }
	| { type: "end" }
	| { type: "escape" };

const LINE = 56;

/**
 * Maps a key press to an action. `⌘/Ctrl` shortcuts always apply; plain keys are ignored while
 * typing in a field or with Alt held. `boxH` sizes page-wise scrolling (90% of the viewport).
 */
export function keyAction(
	e: Pick<KeyboardEvent, "key" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">,
	typing: boolean,
	boxH: number,
): KeyAction | null {
	const k = e.key;
	if (e.metaKey || e.ctrlKey) {
		if (k === "=" || k === "+") return { type: "zoom", to: "in" };
		if (k === "-") return { type: "zoom", to: "out" };
		if (k === "0") return { type: "zoom", to: "width" };
		if (k === "1") return { type: "zoom", to: 1 };
		if (k.toLowerCase() === "f") return { type: "find" };
		if (k.toLowerCase() === "g") return { type: "match", dir: e.shiftKey ? -1 : 1 };
		return null;
	}
	if (typing || e.altKey) return null;
	const vh = boxH * 0.9;
	switch (k) {
		case "ArrowDown":
		case "j":
			return { type: "scroll", dy: LINE };
		case "ArrowUp":
		case "k":
			return { type: "scroll", dy: -LINE };
		case " ":
			return { type: "scroll", dy: e.shiftKey ? -vh : vh };
		case "PageDown":
			return { type: "scroll", dy: vh };
		case "PageUp":
			return { type: "scroll", dy: -vh };
		case "Home":
			return { type: "home" };
		case "End":
			return { type: "end" };
		case "Escape":
			return { type: "escape" };
		default:
			return null;
	}
}
