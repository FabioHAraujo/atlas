/** Scheduling helpers: idle-time slices with a timeout fallback for webviews lacking `requestIdleCallback`. */

/** Run `fn` in an idle slice (≤100 ms wait); falls back to a short timeout where `requestIdleCallback` is missing. */
export function idle(fn: () => void): number {
	return window.requestIdleCallback
		? window.requestIdleCallback(fn, { timeout: 100 })
		: (window as Window).setTimeout(fn, 8);
}

/** Cancel a handle returned by `idle`. */
export function cancelIdle(id: number) {
	if (window.cancelIdleCallback) window.cancelIdleCallback(id);
	else clearTimeout(id);
}
