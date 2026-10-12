/**
 * App session lifecycle of the main window: boots the stores and native integrations, then
 * keeps the workspace, registry, dock badge and window theme in sync. Returns one cleanup.
 */
import { colorScheme, toast } from "@codeatlasdev/ui";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { untrack } from "svelte";
import { api, errText } from "#lib/api.ts";
import { reconcile } from "#lib/browserSync.ts";
import { host } from "#lib/host.ts";
import { errors, startErrorHandler } from "#lib/errors/errors.svelte.ts";
import { loadKeymap, register } from "#lib/keymap.svelte.ts";
import { startCtl } from "#lib/ctl.ts";
import { startMenu } from "#lib/menu.svelte.ts";
import { nativeFeel } from "#lib/native.ts";
import { metrics } from "#lib/panel/metrics.svelte.ts";
import { shellCommands } from "#lib/shell/commands.svelte.ts";
import { shell } from "#lib/shell/shell.svelte.ts";
import { agents } from "#lib/stores/agents.svelte.ts";
import { browserPrefs } from "#lib/stores/browser.svelte.ts";
import { initHostStatus } from "#lib/stores/gpu.svelte.ts";
import { loadPrefs } from "#lib/stores/prefs.svelte.ts";
import { store } from "#lib/stores/projects.svelte.ts";
import { quick } from "#lib/stores/quick.svelte.ts";
import { themes } from "#lib/stores/theme.svelte.ts";
import { startTrayFeed } from "#lib/stores/trayFeed.svelte.ts";
import { updates } from "#lib/stores/updates.svelte.ts";
import { ws } from "#lib/stores/workspace.svelte.ts";
import { hooks, worktrees } from "#lib/stores/worktrees.svelte.ts";

/** The live stores, shared with `ctl.ts` (HMR-safe) and, in debug builds, `atlas desktop debug eval`. */
function exposeStores() {
	const stores = { ws, store, agents, worktrees, api, host };
	if ("__ATLAS_DEBUG__" in window) {
		Object.assign(window, {
			__atlas: {
				...stores,
				/** Make tab `id` throw on its next render (`on = false` heals it); exercises the error boundaries. */
				crashTab: (id: string, on = true) => (on ? (errors.crashing[id] = true) : delete errors.crashing[id]),
				/** Reject from a timer: no boundary can catch it, so it surfaces as the toast. */
				throwLater: (msg = "Debug: uncaught error from a timer") =>
					setTimeout(() => void Promise.reject(new Error(msg)), 0),
			},
		});
	}
	Object.assign(window, { __atlasCtlStores: stores });
}

/** Reactive syncs between the workspace, the project registry and the OS. */
function syncEffects() {
	// The native sidebar material follows the window appearance, not CSS:
	// pin it to the chosen theme (null = follow macOS).
	$effect(() => {
		const p = colorScheme.preference;
		getCurrentWindow()
			.setTheme(p === "system" ? null : p)
			.catch(() => {});
	});

	// Once, right after the workspace loads: close native browser views whose tab is gone
	// (closed while the app was down, ⌘W racing a reload). Reconciling against an empty tab
	// list would close every live view, hence the wait; `untrack` keeps later tab changes
	// from re-running it (those close their own view through `closeTab`).
	$effect(() => {
		if (!ws.loaded) return;
		untrack(
			() =>
				void reconcile(
					invoke,
					ws.doc.tabs.filter((t) => t.kind === "browser").map((t) => t.id),
				).catch(() => {}),
		);
	});

	// Dock badge = unread worktrees.
	$effect(() => {
		const n = ws.doc.worktrees.filter((w) => w.unread).length;
		void invoke("set_badge", { count: n }).catch(() => {});
	});

	// Registry entries (main checkouts + linked worktrees) mirror into the workspace.
	$effect(() => {
		const projects = store.projects;
		if (ws.loaded && store.loaded) untrack(() => worktrees.sync(projects));
	});

	// Import worktrees created outside Atlas, once per repo.
	const imported: Record<string, true> = {};
	$effect(() => {
		if (!store.loaded) return;
		for (const p of store.projects)
			if (!p.parent && !imported[p.id]) {
				imported[p.id] = true;
				api.worktreesImport(p.id).then(
					(n) => {
						if (n) void store.refresh();
					},
					() => {},
				);
			}
	});

	// Selection follows the sidebar; a fresh worktree opens its default tab.
	$effect(() => {
		const id = store.selected;
		const ready = ws.loaded && store.loaded && store.projects.length;
		untrack(() => {
			if (!ready || !id || !ws.worktree(id)) return;
			if (ws.doc.selected !== id) ws.select(id);
			ws.ensureLayout(id);
			ws.ensurePanel(id);
		});
	});

	// Remember (worktree, tab) visits for ⌘[ / ⌘].
	$effect(() => {
		const w = ws.selected;
		if (!w || ws.view !== "worktree") return;
		const tabId = ws.focusedGroup(w.id).activeTab;
		untrack(() => shell.note({ worktreeId: w.id, tabId }));
	});
}

export function startSession(): () => void {
	const fail = (e: unknown) => toast.error(errText(e));
	store.init().catch(fail);
	updates.init().catch(fail);
	ws.init().catch(fail);
	agents.init().catch(fail);
	quick.init().catch(fail);
	browserPrefs.init().catch(() => {});
	const stopHostStatus = initHostStatus().catch(() => () => {});
	// A webview reload leaves native browser views from the last page behind, at the old
	// rects. Park them at once; the reconcile effect closes the orphans once the
	// workspace has loaded, and each live tab's BrowserTab re-adopts and re-places its own.
	void invoke("browser_hide_all").catch(() => {});
	startCtl().catch(() => {});
	loadKeymap().catch(() => {});
	const stopMenu = startMenu();
	loadPrefs().catch(() => {});
	themes.init().catch(fail);
	const unregister = register(shellCommands());
	hooks.launchAgent = (id, agent, prompt) => agents.launch(id, agent, { prompt });
	exposeStores();
	const stopFeel = nativeFeel();
	const stopTray = startTrayFeed();
	// The popover's sparklines need samples even with no Panel open.
	const stopMetrics = metrics.start();
	const stopEffects = $effect.root(syncEffects);
	const stopErrors = startErrorHandler();
	return () => {
		unregister();
		void stopMenu.then((f) => f());
		void stopHostStatus.then((f) => f());
		store.dispose();
		updates.dispose();
		ws.dispose();
		agents.dispose();
		stopFeel();
		stopErrors();
		stopTray();
		stopMetrics();
		stopEffects();
	};
}
