// The native capture and the in-app script runner fail with plain messages. An agent (or a human) needs the cause AND
// the fix in one place, so each known failure maps to a StudioError with a concrete hint. Unknown failures are kept
// verbatim: never swallowed, never reworded into something false.

import { StudioError } from "../lib/paths.ts";

const RULES: { test: RegExp; hint: string }[] = [
	{
		test: /Screen Recording permission/i,
		hint: "grant Screen Recording to Atlas (or to the terminal that launched it): System Settings > Privacy & Security > Screen Recording, then restart it. Stills with `--mode snapshot` need no permission.",
	},
	{
		test: /not capturable|minimized|another Space|no frames were captured|is hidden/i,
		hint: "the window must be on screen (not minimized, not on another Space, not hidden). It may be behind other windows. Show it, or take stills with `--mode snapshot`, which works regardless.",
	},
	{ test: /macOS 15/i, hint: "video capture needs macOS 15+ (ScreenCaptureKit recording output). Stills work on macOS 14+, and `--mode snapshot` everywhere." },
	{ test: /already running/i, hint: "an earlier run left a recording open in this instance: `atlas desktop capture stop`, or restart the instance." },
	{ test: /not running; launch/i, hint: "start an instance: `bun studio capture` brings up an isolated one for you; for your own app run `atlas desktop`." },
	{
		test: /timed out after|no element matches|nothing visible to click/i,
		hint: "the selector never matched a visible element. Find the right one against the live app: `atlas desktop debug eval \"return [...document.querySelectorAll('[class]')].map(e => e.className)\"`; the step index in the message is the script's steps[] index.",
	},
	{ test: /invalid script/i, hint: "fix the listed fields; the grammar is apps/desktop/src/lib/capture/script.ts." },
];

/** Turn a native/runner failure message into a StudioError with the fix. The message is never altered. */
export function explainCaptureFailure(message: string): StudioError {
	const rule = RULES.find((r) => r.test.test(message));
	return new StudioError(message, rule?.hint ?? "see the app log: the isolated instance writes app.log in its scratch dir; run with --keep to keep it.");
}
