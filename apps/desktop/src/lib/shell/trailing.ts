/**
 * Run `fn` once, `ms` after the last call of a burst. A selection or a commit re-renders a lot at once and asks
 * for the same measurement many times; measuring in the commit frame forces layout on fresh DOM changes (a
 * measured 30-50 ms stall), so the measurement waits for the burst to end. Timers are injectable for tests.
 */
export function trailing(
	fn: () => void,
	ms: number,
	set: (f: () => void, ms: number) => unknown = (f, m) => setTimeout(f, m),
	clear: (t: unknown) => void = (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
) {
	let timer: unknown = null;
	const call = () => {
		if (timer !== null) clear(timer);
		timer = set(() => {
			timer = null;
			fn();
		}, ms);
	};
	call.cancel = () => {
		if (timer !== null) clear(timer);
		timer = null;
	};
	return call;
}

/** What the engine is told about a swipe entry besides its rect: which neighbours exist and whether it is pinned. */
export function availability(s: { can: (d: 1 | -1) => boolean; pinned?: () => boolean }): string {
	return `${+s.can(-1)}${+s.can(1)}${+(s.pinned?.() ?? false)}`;
}

/** Signature of every entry's availability, in registration order: a changed key means the engine must be told. */
export function availabilityKey(entries: Iterable<{ spec: Parameters<typeof availability>[0] }>): string {
	return [...entries].map((e) => availability(e.spec)).join("|");
}
