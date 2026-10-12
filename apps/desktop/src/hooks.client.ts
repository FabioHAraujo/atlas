import type { HandleClientError } from "@sveltejs/kit/hooks";
import { messageOf } from "#lib/errors/report.ts";

/**
 * SvelteKit reduces anything unexpected to `{ status: 500, message: "Internal Error" }` so a
 * server never leaks internals. This is a local app with no remote audience, and a report that
 * says "Internal Error" is useless: keep the real message for `+error.svelte` (the console
 * still gets the original error with its stack).
 */
export const handleError: HandleClientError = ({ error, kind }) => {
	if (kind === "unknown") {
		console.error("[atlas] unhandled route error:", error);
		return { message: messageOf(error), stack: error instanceof Error ? error.stack : undefined };
	}
};
