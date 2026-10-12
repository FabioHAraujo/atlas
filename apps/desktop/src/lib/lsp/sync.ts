/**
 * Keeps the frontend's view of hostd's language servers current. Status pushes only fire when
 * something changes, so a webview that starts (or reloads) after servers are already running would
 * never learn about them: the list is pulled at start and after every reconnect too. Plain module
 * (no runes, no Tauri import) so it is testable with its transport injected.
 */
export interface SyncDeps {
	listen: (ev: string, handler: (e: { payload: unknown }) => void) => Promise<() => void>;
	fetchServers: () => Promise<{ name: string }[]>;
	apply: (servers: never[]) => void;
	reopenAll: () => void;
	onEvent?: (payload: unknown) => void;
}

export function startSync(d: SyncDeps): () => void {
	const pull = () =>
		d
			.fetchServers()
			.then((s) => d.apply(s as never[]))
			// An old host does not know `lsp_status`; the status item explains that state on its own.
			.catch(() => {});
	const offs = Promise.all([
		d.listen("host://event", (e) => {
			const p = e.payload;
			if (p && typeof p === "object" && "ev" in p && p.ev === "lsp_status" && "servers" in p)
				d.apply(p.servers as never[]);
			else d.onEvent?.(p);
		}),
		d.listen("host://reconnected", () => {
			void pull();
			d.reopenAll();
		}),
	]);
	void pull();
	return () => void offs.then((all) => all.forEach((f) => f()));
}
