/** ⌘W: close the focused tab, asking first when a terminal still runs a foreground program. */
import { toast } from "@codeatlasdev/ui";
import { host } from "#lib/host.ts";
import { confirmDialog } from "#lib/stores/ask.svelte.ts";
import { pinned } from "#lib/stores/tabs.ts";
import { ws } from "#lib/stores/workspace.svelte.ts";

export async function closeActive() {
	const w = ws.selected;
	if (!w) return;
	const g = ws.focusedGroup(w.id);
	const t = ws.tab(g.activeTab);
	if (!t) return;
	if (pinned(t)) {
		// The Panel stays open: tell the user once, and move on to a neighbour.
		toast.info("The Panel stays open");
		const next = g.order.find((id) => !pinned(ws.tab(id)));
		if (next) ws.activate(next);
		return;
	}
	if (t.pty && !(t.pty in ws.exited)) {
		const info = await host.ptyInfo(t.pty).catch(() => null);
		const shell = (t.argv?.length ? t.argv[0] : info?.argv[0])?.split("/").pop();
		if (
			info?.fg &&
			info.fg.name.replace(/^-/, "") !== shell &&
			!(await confirmDialog(`${info.fg.name} is still running`, {
				description: "Closing the tab ends it.",
				confirmLabel: "Close tab",
				destructive: true,
			}))
		)
			return;
	}
	ws.closeTab(t.id);
}
