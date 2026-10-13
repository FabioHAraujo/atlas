/**
 * The real environment of a scripted recording: the app's own live stores (`window.__atlasCtlStores`, the same ones
 * `atlas wt|term` use, present in every build) and the native recorder behind `capture_*` on the ctl socket.
 * Nothing here sends OS input.
 */

import { invoke } from "@tauri-apps/api/core";
import type { host } from "#lib/host.ts";
import type { store } from "#lib/stores/projects.svelte.ts";
import type { ws } from "#lib/stores/workspace.svelte.ts";
import { createCursor } from "./cursor.ts";
import {
	clickByText,
	clickBySelector,
	elementRect,
	findByText,
	pressKey,
	realSleep,
	smoothScroll,
	typeInto,
	waitForQuiet,
} from "./dom.ts";
import { easeInOutCubic } from "./motion.ts";
import type { AppOps, Native, RunEnv, StartInfo, StopInfo } from "./runner.ts";

interface Stores {
	ws: typeof ws;
	store: typeof store;
	host: typeof host;
}

function stores(): Stores {
	const s = (window as Window & { __atlasCtlStores?: Stores }).__atlasCtlStores;
	if (!s) throw new Error("Atlas Desktop stores not ready (window not mounted yet)");
	return s;
}

const LABELS = { services: "Panel", logs: "Logs", config: "Config" } as const;
const SETTLE_MS = 400;
const SHELL_QUIET_MS = 600;
const SHELL_READY_MS = 30_000;

function selectedWorktreeId(): string {
	const w = stores().ws.selected;
	if (!w) throw new Error("no worktree is selected; add a `worktree` step first");
	return w.id;
}

function findWorktree(project: string, name?: string) {
	const { ws, store } = stores();
	const repo = store.projects.find((p) => !p.parent && p.name === project);
	if (!repo) throw new Error(`no project named ${project}`);
	const w = ws.doc.worktrees.find(
		(x) =>
			x.repoId === repo.id && (name === undefined ? x.isMain : x.name === name || x.branch.endsWith(name)),
	);
	if (!w) throw new Error(`no worktree ${project}/${name ?? "main"}`);
	return w;
}

/** Native calls over the app's own IPC: the same handlers the ctl socket serves, minus the socket. */
const native: Native = {
	start: (a) => invoke<StartInfo>("capture_cmd", { cmd: "capture_start", args: a }),
	stop: () => invoke<StopInfo>("capture_cmd", { cmd: "capture_stop", args: {} }),
	shot: (a) => invoke("capture_cmd", { cmd: "capture_shot", args: a }),
};

const app = (cursor = createCursor()): AppOps => ({
	rect: elementRect,
	async click(a) {
		return a.selector !== undefined ? clickBySelector(a.selector) : clickByText(a.text ?? "");
	},
	type: async (sel, text, delay) => void (await typeInto(sel, text, delay)),
	key: (c) => void pressKey(c),
	async view(v) {
		stores().ws.view = v;
		await realSleep(SETTLE_MS);
	},
	async worktree(project, name) {
		const { ws, store } = stores();
		const w = findWorktree(project, name);
		ws.view = "worktree";
		// the sidebar follows `store.selected`, the workspace `ws.select`: the real app moves both together
		store.selected = w.id;
		ws.select(w.id);
		await realSleep(SETTLE_MS);
	},
	async tab(kind) {
		const { ws } = stores();
		ws.reveal(selectedWorktreeId(), (t) => t.kind === kind, { kind, label: LABELS[kind] });
		await realSleep(SETTLE_MS);
	},
	async terminal(argv, label) {
		const t = await stores().ws.newTerminal(selectedWorktreeId(), { argv, label: label ?? "Terminal" });
		if (!t) throw new Error("the terminal did not start");
	},
	async run(command, delay) {
		const { ws, host } = stores();
		const t = await ws.newTerminal(selectedWorktreeId(), { argv: [], label: "Terminal" });
		if (!t?.pty) throw new Error("the terminal did not start");
		// typing starts when the shell's startup output has stopped (prompt drawn), however slow its rc files are
		const pty = t.pty;
		await waitForQuiet(() => host.ptyRead(pty, 50), {
			quietMs: SHELL_QUIET_MS,
			timeoutMs: SHELL_READY_MS,
			pollMs: 100,
		});
		for (const ch of `${command}\r`) {
			await host.ptyWrite(t.pty, ch);
			await realSleep(delay);
		}
	},
	async scroll(sel, to, ms) {
		await smoothScroll(sel, to, ms, easeInOutCubic);
	},
	async terminalHas(contains) {
		const { ws, host } = stores();
		const t = ws.selected ? ws.focusedTab(ws.selected.id) : undefined;
		if (!t?.pty) return false;
		return (await host.ptyRead(t.pty, 200)).includes(contains);
	},
	textVisible: (text) => findByText(text) !== undefined,
	cursor,
	caption: setCaption,
});

const CAPTION_ID = "__atlas_capture_caption";
function setCaption(text: string | null) {
	document.getElementById(CAPTION_ID)?.remove();
	if (text === null) return;
	const el = document.createElement("div");
	el.id = CAPTION_ID;
	el.textContent = text;
	el.style.cssText =
		"position:fixed;left:50%;bottom:48px;transform:translateX(-50%);max-width:70%;padding:10px 18px;border-radius:12px;background:rgba(10,10,12,.82);color:#fff;font:600 20px/1.3 system-ui;z-index:2147483646;pointer-events:none";
	document.body.append(el);
}

export function realEnv(): RunEnv {
	return { now: Date.now, sleep: realSleep, native, app: app() };
}
