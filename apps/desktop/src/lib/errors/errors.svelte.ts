/**
 * Non-render errors (event handlers, timers, promises) never reach a `<svelte:boundary>`.
 * `startErrorHandler` funnels window `error` / `unhandledrejection` into one place: log it
 * (`console.error`, which the debug bridge captures), and show one non-blocking toast per
 * distinct error with a "Details" action that opens the same panel used for crashed views.
 */
import { invoke } from "@tauri-apps/api/core";
import { fingerprint, isBenign, messageOf, report, type ErrorReport } from "./report.ts";

/** Same error inside this window collapses into one toast. */
const DEDUPE_MS = 10_000;
const MAX_SEEN = 50;

class Errors {
	/** The error whose details dialog is open. */
	current = $state<ErrorReport | null>(null);
	/** Toasts waiting to be rendered by `ErrorToasts`; the store owns dedupe, the view owns layout. */
	toasts = $state<{ id: number; report: ErrorReport; repeats: number }[]>([]);
	/** Debug builds only (`window.__atlas.crashTab`): ids whose next render throws, to exercise the boundaries. */
	crashing = $state<Record<string, true>>({});
	#version: Promise<string | undefined> | undefined;
	#seen = new Map<string, { at: number; id: number }>();
	#next = 1;

	/** Cached `system_info().app.version`; undefined when the call fails (tray webview, tests). */
	version(): Promise<string | undefined> {
		this.#version ??= invoke<{ app: { version: string } }>("system_info").then(
			(i) => i.app.version,
			() => undefined,
		);
		return this.#version;
	}

	async capture(e: unknown, where: string) {
		const message = messageOf(e);
		if (isBenign(e, message)) return;
		const r = { ...report(e, { where }), version: await this.version() };
		console.error(`[atlas] ${where}: ${r.message}`, e instanceof Error ? e : "");
		const fp = fingerprint(r);
		const now = Date.now();
		const prev = this.#seen.get(fp);
		if (prev && now - prev.at < DEDUPE_MS) {
			prev.at = now;
			const t = this.toasts.find((x) => x.id === prev.id);
			if (t) t.repeats += 1;
			return;
		}
		if (this.#seen.size >= MAX_SEEN) this.#seen.delete(this.#seen.keys().next().value as string);
		const id = this.#next++;
		this.#seen.set(fp, { at: now, id });
		this.toasts.push({ id, report: r, repeats: 0 });
	}

	dismiss(id: number) {
		this.toasts = this.toasts.filter((t) => t.id !== id);
	}

	show(r: ErrorReport, toastId?: number) {
		this.current = r;
		if (toastId !== undefined) this.dismiss(toastId);
	}
}

export const errors = new Errors();

/** Install the window listeners. Returns the cleanup. */
export function startErrorHandler(where = "window"): () => void {
	const onError = (ev: ErrorEvent) => void errors.capture(ev.error ?? ev.message, where);
	const onRejection = (ev: PromiseRejectionEvent) => void errors.capture(ev.reason, where);
	window.addEventListener("error", onError);
	window.addEventListener("unhandledrejection", onRejection);
	return () => {
		window.removeEventListener("error", onError);
		window.removeEventListener("unhandledrejection", onRejection);
	};
}
