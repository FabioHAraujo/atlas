// Scene building blocks shared by several scenes: the film's three orbit-shop worktrees with their fake agents, and
// the log history/stack warm-up. Everything is deterministic (fixed names, scripted agents, seeded memhog).

import type { FixtureName } from "../run/recipe.ts";
import type { Ctx } from "./ctx.ts";
import { ORBIT_WORKTREES } from "./app.ts";

/** Creates orbit-shop's worktrees through the app (same path as `atlas wt create`), without agents or setup terminals. */
export async function createWorktrees(ctx: Ctx): Promise<string[]> {
	const ids: string[] = [];
	for (const w of ORBIT_WORKTREES) {
		const id = await ctx.eval<string | null>(
			`const a = window.__atlas; const repo = a.store.projects.find(p => !p.parent && p.name === "orbit-shop");
			 return (await a.worktrees.create({ repoId: repo.id, name: ${JSON.stringify(w.name)}, runSetup: false, agent: "blank" })) ?? null`
		);
		if (!id) throw new Error(`worktree ${w.name} was not created (see the app log)`);
		// "blank" opens a plain terminal tab; the scenes want only what they open themselves. Let its native GPU view
		// mount first, select it so it is the visible tab, then close it: closing a never-mounted tab leaves an orphan
		// native view painted over the whole pane.
		await ctx.sleep(1500);
		await ctx.eval(`const a = window.__atlas; for (const t of a.ws.tabsOf(${JSON.stringify(id)}).filter(t => t.kind === "terminal")) a.ws.closeTab(t.id, true, true); return 1`);
		await ctx.sleep(700);
		ids.push(id);
	}
	return ids;
}

/**
 * One fake `omp` agent per worktree, staggered: the first reaches its approval prompt quickly ("blocked") and goes on to
 * finish, the second stays blocked for a minute, the third asks a few seconds later. `askSeconds` per agent.
 */
export async function launchAgents(ctx: Ctx, ids: string[], askSeconds: number[]): Promise<void> {
	for (const [i, w] of ORBIT_WORKTREES.entries()) {
		const id = ids[i]!;
		await ctx.eval(
			`const a = window.__atlas, ws = a.ws, ag = a.agents; const worktreeId = ${JSON.stringify(id)};
			 const tabId = crypto.randomUUID();
			 const t = await ws.newTerminal(worktreeId, { tabId, argv: [${JSON.stringify(`${ctx.env.fakeAgentDir}/omp`)}, ${JSON.stringify(w.prompt)}],
			   env: { ATLAS_PANE_KEY: tabId, ATLAS_AGENT: "omp", ATLAS_LAUNCH_TOKEN: "demo", DEMO_DELAY: "${i * 3}", DEMO_ASK: "${askSeconds[i] ?? 6}", HOME: ${JSON.stringify(ctx.env.home)} },
			   agent: "omp", label: "omp" });
			 ag.status[tabId] = { state: "idle", agent: "omp", session_id: null, session_file: null, model: null, prompt: ${JSON.stringify(w.prompt)}, last_message: null,
			   updated_at: Date.now(), state_started_at: Date.now(), worktree_id: worktreeId, tab_id: tabId };
			 try { await window.__TAURI_INTERNALS__.invoke("agent_bind", { pane: tabId, agent: "omp", cwd: ws.worktree(worktreeId).path }); } catch (e) {}
			 return t.id`
		);
	}
}

/** Seconds of log/metric history a stack needs before the panel charts and the logs search look believable. */
const WARM_MS = 30_000;

/**
 * The states recipes start from (`fixture` in a recipe capture). Each runs in a fresh app, before the recorder rolls;
 * the recipe's script then drives the UI. Typed by `FIXTURE_NAMES`, so a name without an implementation (or the
 * reverse) does not compile.
 */
export const FIXTURES: Record<FixtureName, (ctx: Ctx) => Promise<void>> = {
	/** orbit-shop's three worktrees and its whole stack up, with enough history for charts, errors and warnings. */
	async "orbit-stack"(ctx) {
		await createWorktrees(ctx);
		await ctx.worktree("orbit-shop");
		await ctx.startStack("orbit-shop", 5, 90_000);
		await ctx.sleep(WARM_MS);
	},
	/** The stack plus three scripted agents (working / blocked / done arc), the sidebar open on orbit-shop. */
	async "orbit-agents"(ctx) {
		const ids = await createWorktrees(ctx);
		await ctx.worktree("orbit-shop");
		await ctx.sidebar("show");
		await ctx.startStack("orbit-shop", 5, 90_000);
		await launchAgents(ctx, ids, [2, 60, 7]);
		await ctx.eval(`const a = window.__atlas; const w = a.ws.doc.worktrees.find(w => w.name === "checkout-shipping"); a.store.selected = w.id; a.ws.select(w.id); return 1`);
	},
	/** Every project's stack up (green dots, n/m counts), the sidebar open with "Other projects" expanded. */
	async "orbit-spaces"(ctx) {
		await createWorktrees(ctx);
		for (const [project, up] of [["lumen-app", 1], ["nova-docs", 1], ["pulse-api", 1], ["orbit-shop", 5]] as const) await ctx.startStack(project, up, 90_000);
		await ctx.worktree("orbit-shop");
		await ctx.sidebar("show");
		await ctx.eval(`const b = document.querySelector('.sidebar-slot button.section[aria-expanded="false"]'); b?.click(); return !!b`);
		await ctx.sleep(1500);
	},
};
