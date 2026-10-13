#!/usr/bin/env bun
/**
 * Space-switch baseline for ANY build of the desktop app, old or new: the part both versions share is the
 * programmatic switch (`shell.switchTo`, what ⌃⇥ / a sidebar click / ⌘-number do). The page-side probe is injected
 * through `debug eval` (no app change needed), so it runs against a bundle built from an old commit too:
 *
 *   git worktree add /tmp/gbase <commit> && (build there) && bun run desktop:agent -- --name base --scratch
 *   ATLAS_BIN=/tmp/gbase/target/debug/atlas ATLAS_DEBUG_SOCK=… bun scripts/gesture-baseline.ts [--switches 12]
 *
 * It selects the spaces one after another (the middle one first), waits for the switch to settle, and records per
 * switch: frame gaps (rAF), main-thread stalls (MessageChannel ping-pong), forced layouts, and the time from the
 * call to the first frame that shows the new space. The old build cannot replay a trackpad trace (it asked AppKit's
 * `trackSwipeEvent`, which needs the real event queue), so this is the like-for-like number.
 */
import { spawnSync } from "node:child_process";
import { loadavg } from "node:os";
import { join } from "node:path";

const bin =
	process.env.ATLAS_BIN ?? join(import.meta.dir, "../target/debug/atlas");
const arg = (n: string) => process.argv[process.argv.indexOf(n) + 1];

function evalIn(js: string): unknown {
	const r = spawnSync(bin, ["desktop", "debug", "eval", js], {
		encoding: "utf8",
		maxBuffer: 64 << 20,
	});
	if (r.status !== 0)
		throw new Error(`debug eval failed: ${r.stderr || r.stdout}`);
	return JSON.parse(r.stdout);
}

const SPACES = 5;
const switches = Number(arg("--switches") ?? 12);

// Same seeding as the gesture bench: tiny git repos registered through projects_add (idempotent).
function seed() {
	const have = evalIn(
		`return window.__atlas.store.sorted.filter((p) => !p.parent).length`,
	) as number;
	for (let i = have; i < SPACES; i++) {
		const dir = join(
			process.env.TMPDIR ?? "/tmp",
			"atlas-gesture-bench",
			`space${i + 1}`,
		);
		spawnSync("mkdir", ["-p", join(dir, "src")]);
		spawnSync("sh", [
			"-c",
			`echo 'export const space = ${i + 1};' > ${dir}/src/a.ts; printf 'name: bench${i + 1}\\nservices:\\n  web:\\n    command: "sleep 3600"\\n' > ${dir}/atlas.yaml`,
		]);
		const git = (...a: string[]) =>
			spawnSync("git", [
				"-C",
				dir,
				"-c",
				"user.email=b@b",
				"-c",
				"user.name=bench",
				...a,
			]);
		git("init", "-q");
		git("add", "-A");
		git("commit", "-qm", "bench");
		evalIn(
			`return await window.__TAURI_INTERNALS__.invoke("projects_add", { root: ${JSON.stringify(dir)} }).then((p) => p.id, (e) => String(e))`,
		);
	}
	for (let i = 0; i < 2; i++)
		evalIn(`await new Promise((r) => setTimeout(r, 1000)); return 1`);
}

seed();
// let the startup work (spaces mounting, first snapshots, language servers) finish: it is not part of a switch
for (let i = 0; i < 4; i++)
	evalIn(`await new Promise((r) => setTimeout(r, 1000)); return 1`);

type Row = {
	to: string;
	commitToPaintMs: number;
	worstGap: number;
	p95Gap: number;
	stalls: { t: number; ms: number }[];
	reflows: number;
	selectedAfter: string;
};

// One switch per eval: the bridge answers within 10 s, a whole loop of them would not.
evalIn(`
	const a = window.__atlas;
	const ids = a.store.sorted.filter((p) => !p.parent).map((p) => p.id);
	window.__gb = { ids, reflows: 0, reads: 0, on: false };
	// a layout read is a FORCED layout only if the DOM changed since the last read (same rule as the gesture bench)
	const mo = new MutationObserver(() => {}); mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
	const hit = () => { const g = window.__gb; if (!g.on) return; g.reads++; if (mo.takeRecords().length > 0) g.reflows++; };
	const wrap = (proto, names) => { for (const n of names) { const d = Object.getOwnPropertyDescriptor(proto, n); if (!d) continue;
		if (typeof d.value === "function") { const o = d.value; Object.defineProperty(proto, n, { ...d, value: function (...x) { hit(); return o.apply(this, x); } }); }
		else if (d.get) { const g = d.get; Object.defineProperty(proto, n, { ...d, get() { hit(); return g.call(this); } }); } } };
	if (!window.__gbWrapped) { wrap(Element.prototype, ["getBoundingClientRect", "getClientRects"]); wrap(HTMLElement.prototype, ["offsetWidth", "offsetHeight", "offsetTop", "offsetLeft"]); window.__gbWrapped = true; }
	const mid = ids[Math.floor(ids.length / 2)];
	a.store.selected = mid; a.ws.select(mid);
	await new Promise((r) => setTimeout(r, 1500));
	return ids.length;`);

const ids = evalIn(`return window.__gb.ids`) as string[];
/** A cold page can take longer than the bridge's answer window for its first switch: retry that eval. */
function evalRetry(js: string, tries = 3): unknown {
	for (let i = 1; ; i++) {
		try {
			return evalIn(js);
		} catch (e) {
			if (i >= tries) throw e;
		}
	}
}

const rows: Row[] = [];
// one untimed switch first: the very first switch of a cold page mounts and warms things, which is not what is compared
evalRetry(
	`document.querySelector('button.space[role="tab"]:not(.on)')?.click(); await new Promise((r) => setTimeout(r, 1500)); return 1`,
);
for (let i = 0; i < switches; i++) {
	const to = ids[(Math.floor(ids.length / 2) + 1 + i) % ids.length]!;
	rows.push(
		evalRetry(`
		const a = window.__atlas, to = ${JSON.stringify(to)}, g = window.__gb;
		const gaps = [], stalls = []; let last = performance.now(), raf = 0, t0 = 0, stop = false;
		const tick = (t) => { gaps.push(t - last); last = t; if (!stop) raf = requestAnimationFrame(tick); };
		const ch = new MessageChannel(); let pinged = 0;
		ch.port1.onmessage = () => { const ms = performance.now() - pinged; if (ms > 4) stalls.push({ t: Math.round(performance.now() - t0), ms: Math.round(ms) }); if (!stop) setTimeout(ping, 0); };
		const ping = () => { pinged = performance.now(); ch.port2.postMessage(0); };
		g.reflows = 0; g.on = true; t0 = performance.now(); last = t0; raf = requestAnimationFrame(tick); ping();
		// the switch exactly as a click on the space strip does it (shell.switchTo), through the DOM so it works on
		// builds that do not expose shell on window.__atlas
		const name = a.store.sorted.find((p) => p.id === to).name;
		const btn = [...document.querySelectorAll('button.space[role="tab"]')].find((b) => b.getAttribute("aria-label") === name);
		if (!btn) throw new Error("no space button for " + name);
		btn.click();
		await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
		const painted = performance.now() - t0;
		await new Promise((r) => setTimeout(r, 900));
		stop = true; g.on = false; cancelAnimationFrame(raf);
		const s = gaps.slice(1).sort((x, y) => x - y);
		return { to, commitToPaintMs: Math.round(painted), worstGap: Math.round(s.at(-1) ?? 0), p95Gap: Math.round(s[Math.floor(s.length * 0.95)] ?? 0), stalls, reflows: g.reflows, selectedAfter: a.store.selected };`) as Row,
	);
}

const idle = evalIn(`
	const gaps = []; const stalls = []; let last = performance.now(), stop = false, t0 = performance.now();
	const tick = (t) => { gaps.push(t - last); last = t; if (!stop) requestAnimationFrame(tick); };
	requestAnimationFrame(tick);
	const ch = new MessageChannel(); let pinged = 0;
	ch.port1.onmessage = () => { const ms = performance.now() - pinged; if (ms > 4) stalls.push(ms); if (!stop) setTimeout(ping, 0); };
	const ping = () => { pinged = performance.now(); ch.port2.postMessage(0); };
	ping();
	await new Promise((r) => setTimeout(r, 3000)); stop = true;
	const g = gaps.slice(1).sort((x, y) => x - y);
	return { p95: Math.round(g[Math.floor(g.length * 0.95)] ?? 0), worstStall: Math.round(Math.max(0, ...stalls)) };`) as {
	p95: number;
	worstStall: number;
};

const pct = (xs: number[], p: number) =>
	[...xs].sort((a, b) => a - b)[
		Math.min(xs.length - 1, Math.floor(xs.length * p))
	] ?? 0;
console.log(
	`host load ${loadavg()
		.map((x) => x.toFixed(1))
		.join(
			" ",
		)}; idle floor: gap p95 ${idle.p95} ms, worst stall ${idle.worstStall} ms`,
);
console.log(
	"switch  commit→paint  worst gap  p95 gap  stalls (ms)            reflows",
);
for (const [i, r] of rows.entries())
	console.log(
		`${String(i + 1).padStart(6)}  ${String(r.commitToPaintMs).padStart(12)}  ${String(r.worstGap).padStart(9)}  ${String(r.p95Gap).padStart(7)}  ${r.stalls
			.map((s) => s.ms)
			.join(",")
			.padEnd(22)} ${r.reflows}`,
	);
const wrong = rows.filter((r) => r.selectedAfter !== r.to).length;
console.log(
	`\nsummary over ${rows.length} switches: commit→paint p50 ${pct(
		rows.map((r) => r.commitToPaintMs),
		0.5,
	)} / p95 ${pct(
		rows.map((r) => r.commitToPaintMs),
		0.95,
	)} ms; ` +
		`worst gap p50 ${pct(
			rows.map((r) => r.worstGap),
			0.5,
		)} / max ${Math.max(...rows.map((r) => r.worstGap))} ms; ` +
		`stalls/switch ${(rows.reduce((a, r) => a + r.stalls.length, 0) / rows.length).toFixed(1)}; ` +
		`longest stall ${Math.max(0, ...rows.flatMap((r) => r.stalls.map((s) => s.ms)))} ms; ` +
		`reflows/switch ${(rows.reduce((a, r) => a + r.reflows, 0) / rows.length).toFixed(1)}; wrong target ${wrong}/${rows.length}`,
);
