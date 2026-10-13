#!/usr/bin/env bun
/**
 * Runtime regression for legibility: for every bundled theme, in both appearances, walk the key screens of a real
 * Atlas Desktop (an agent instance: never the user's screen) and run `atlas desktop debug contrast` on each. Exit 1
 * when any screen has a failure.
 *
 *   bun scripts/contrast-audit.ts                       # starts + stops its own instance (name: contrast-audit)
 *   bun scripts/contrast-audit.ts --themes "Alucard,One Light" --screens sidebar,settings-appearance
 *   bun scripts/contrast-audit.ts --json /tmp/contrast.json --md /tmp/contrast.md
 *   ATLAS_DEBUG_SOCK=… bun scripts/contrast-audit.ts --attach   # use an instance you already started
 *
 * Per screen it runs the text audit (`atlas desktop debug contrast`: every visible text node, syntax colours included,
 * 4.5 body / 3 large / 3 disabled+placeholder+gutter) and the non-text audit (`__atlasDebug.nonTextAudit`: icons, field
 * borders and the focused control's outline, 3:1, WCAG 2.2 1.4.11). Overlays (menus, tooltips, dialogs, toasts,
 * popovers) portal to <body>, so those screens audit the whole document. The source of truth for release: 0 failures.
 *
 * The fixture project is created under a temp dir (a git repo with an atlas.yaml and a TypeScript file), added to the
 * instance, and left behind with it (`--scratch` HOME is thrown away on `--stop`).
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ATLAS = "target/debug/atlas";
const arg = (n: string) => {
	const i = process.argv.indexOf(`--${n}`);
	return i < 0 ? undefined : (process.argv[i + 1] ?? "");
};
const flag = (n: string) => process.argv.includes(`--${n}`);
const NAME = arg("name") ?? "contrast-audit";

const THEMES: { name: string; mode: "light" | "dark" }[] = [
	{ name: "Alucard", mode: "light" },
	{ name: "Atlas Light", mode: "light" },
	{ name: "One Light", mode: "light" },
	{ name: "Dracula", mode: "dark" },
	{ name: "Atlas Dark", mode: "dark" },
	{ name: "One Dark", mode: "dark" },
];

const sh = (cmd: string[], env: Record<string, string> = {}) => {
	const p = Bun.spawnSync(cmd, {
		env: { ...process.env, ...env },
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		ok: p.exitCode === 0,
		out: p.stdout.toString(),
		err: p.stderr.toString(),
	};
};

let sock = process.env.ATLAS_DEBUG_SOCK ?? "";
const dbg = (...a: string[]) => {
	const r = sh([ATLAS, "desktop", "debug", ...a], { ATLAS_DEBUG_SOCK: sock });
	if (!r.ok) throw new Error(`debug ${a.join(" ")}: ${r.err || r.out}`);
	return r.out;
};
const evalJs = (js: string) => JSON.parse(dbg("eval", js) || "null");
const sleep = Bun.sleep;

if (!flag("attach")) {
	const r = sh([
		"bun",
		"run",
		"desktop:agent",
		"--",
		"--name",
		NAME,
		"--scratch",
	]);
	const m = /ATLAS_DEBUG_SOCK=(\S+)/.exec(r.out + r.err);
	if (!m)
		throw new Error(`could not start the agent instance:\n${r.out}${r.err}`);
	sock = m[1]!;
}
if (!sock)
	throw new Error(
		"ATLAS_DEBUG_SOCK is not set (or drop --attach to start an instance)",
	);

// the page boots after the socket is up: wait for the stores before driving anything
for (let i = 0; ; i++) {
	const r = sh(
		[
			ATLAS,
			"desktop",
			"debug",
			"eval",
			"return !!(window.__atlas && window.__atlas.ws && window.__atlasDebug)",
		],
		{ ATLAS_DEBUG_SOCK: sock },
	);
	if (r.ok && r.out.trim() === "true") break;
	if (i > 120) throw new Error("the app never finished booting");
	await sleep(500);
}

// --- fixture project -------------------------------------------------------------------------------------------
const root = mkdtempSync(join(tmpdir(), "atlas-contrast-"));
mkdirSync(join(root, "src"));
writeFileSync(
	join(root, "atlas.yaml"),
	`name: demo
services:
  api:
    port: 4101
    command: "node -e \\"require('http').createServer((q,r)=>{console.log('request ok');r.end('ok')}).listen(4101);setInterval(()=>{console.log('tick info');console.error('warn: slow query')},700)\\""
  worker:
    command: "sh -c 'while true; do echo working; sleep 1; done'"
    depends_on: [api]
actions:
  - key: x
    label: Run migrations
    command: "echo migrating"
`,
);
writeFileSync(
	join(root, "src/main.ts"),
	`export function add(a: number, b: number): number {\n\treturn a + b;\n}\nconst x: string = add(1, 2);\nconsole.log(x);\n`,
);
sh(["git", "init", "-q"], { GIT_DIR: join(root, ".git"), GIT_WORK_TREE: root });
sh(["git", "-C", root, "add", "-A"]);
sh([
	"git",
	"-C",
	root,
	"-c",
	"user.email=a@b",
	"-c",
	"user.name=a",
	"commit",
	"-qm",
	"init",
]);

// --- screens ---------------------------------------------------------------------------------------------------
type Screen = {
	id: string;
	setup: string;
	wait?: string;
	teardown?: string;
	selector?: string;
};
const A = "window.__atlas";
/** The sidebar's own row (a real DOM click, like a user): selects the worktree AND switches the view to it. */
const selectWt = `if(!document.querySelector(".pname")) document.querySelector("aside.sidebar .section")?.click(); document.querySelector(".pname")?.click();`;
/** A real chord through the app's keymap (window keydown, capture phase), never OS input. */
const chord = (
	k: string,
	mods = { metaKey: true, shiftKey: true } as Record<string, boolean>,
) =>
	`window.dispatchEvent(new KeyboardEvent("keydown",${JSON.stringify({ key: mods.shiftKey ? k.toUpperCase() : k, code: k.length === 1 ? `Key${k.toUpperCase()}` : k, ...mods, bubbles: true, cancelable: true })}))`;
/** Open a real trigger the way a user does: pointer events + click on the element (DOM events, never OS input). */
const press = (sel: string) =>
	`const e=document.querySelector(${JSON.stringify(sel)}); if(!e) throw new Error("no ${sel.replace(/"/g, "'")}"); for(const t of ["pointerdown","mousedown","pointerup","mouseup","click"]) e.dispatchEvent(new MouseEvent(t,{bubbles:true,cancelable:true,button:0,view:window}));`;
const settings = (target: string, extra = ""): Screen => ({
	id: `settings-${target.replace("/", "-")}`,
	setup: `${A}.updates.show(${JSON.stringify(target)}); ${extra}`,
	teardown: `${A}.updates.open=false;`,
});
const ASK = `${A}.confirmDialog`;
const SCREENS: Screen[] = [
	{
		id: "sidebar",
		setup: `if(!document.querySelector(".pname")) document.querySelector("aside.sidebar .section")?.click();`,
		selector: "aside.sidebar",
	},
	{
		id: "panel",
		setup: `${selectWt} const l=${A}.ws; l.reveal?.(l.doc.selected,(t)=>t.kind==="services",{kind:"services",label:"Panel"});`,
	},
	{
		id: "logs",
		setup: `${selectWt} const l=${A}.ws; l.reveal?.(l.doc.selected,(t)=>t.kind==="logs",{kind:"logs",label:"Logs"});`,
	},
	{
		id: "editor",
		setup: `${selectWt} ${A}.ws.reveal(${A}.ws.doc.selected,(t)=>t.kind==="editor"&&t.path==="src/main.ts",{kind:"editor",label:"main.ts",path:"src/main.ts"});`,
		wait: "document.querySelector('.cm-editor')",
	},
	{
		// The find/replace panel with a query that matches (a search match under code) and a selection on the same
		// line: the surfaces code is read on besides the plain editor. Driven through CodeMirror's own keymap.
		id: "editor-find",
		setup: `${selectWt} ${A}.ws.reveal(${A}.ws.doc.selected,(t)=>t.kind==="editor"&&t.path==="src/main.ts",{kind:"editor",label:"main.ts",path:"src/main.ts"}); await new Promise(r=>setTimeout(r,900)); const c=document.querySelector(".cm-content"); c.focus(); c.dispatchEvent(new KeyboardEvent("keydown",{key:"f",code:"KeyF",metaKey:true,bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,300)); const i=document.querySelector(".cm-find input.cm-textfield, .cm-search input.cm-textfield"); if(i){ i.focus(); i.value="add"; i.dispatchEvent(new InputEvent("input",{bubbles:true})); i.dispatchEvent(new Event("change",{bubbles:true})); } const v=[...${A}.editors.values()][0]; v?.dispatch({selection:{anchor:0,head:16}});`,
		wait: "document.querySelector('.cm-panel')",
	},
	{
		// The completion popup (+ its detail/info) over the editor
		id: "editor-completion",
		setup: `${selectWt} ${A}.ws.reveal(${A}.ws.doc.selected,(t)=>t.kind==="editor"&&t.path==="src/main.ts",{kind:"editor",label:"main.ts",path:"src/main.ts"}); await new Promise(r=>setTimeout(r,900)); const v=[...${A}.editors.values()][0]; v.focus(); v.dispatch({changes:{from:v.state.doc.length,insert:" add"},selection:{anchor:v.state.doc.length+4}}); const c=document.querySelector(".cm-content"); c.dispatchEvent(new KeyboardEvent("keydown",{key:" ",code:"Space",ctrlKey:true,bubbles:true,cancelable:true})); await new Promise(r=>setTimeout(r,800));`,
	},
	settings("general"),
	settings("appearance/appearance"),
	settings("appearance/editor"),
	settings("appearance/languages"),
	settings("appearance/interface"),
	settings("appearance/terminal"),
	settings("workspaces"),
	settings("agents"),
	settings("keyboard"),
	settings("ssh"),
	settings("help"),
	{
		id: "command-palette",
		setup: chord("p"),
		wait: "document.querySelector('input[placeholder=\"Run a command\"]')",
	},
	{
		id: "whats-new",
		setup: `${A}.updates.showWhatsNew();`,
		teardown: `${A}.updates.whatsNewOpen=false;`,
	},
	{
		// An update on offer: the sidebar pill, the sheet's "behind" actions and the channel chips
		id: "whats-new-behind",
		setup: `const u=${A}.updates; u.prefs={...u.prefs,skipped:null}; u.info={...(u.info??{}),cli:{...(u.info?.cli??{}),linked_to:null},app:{...(u.info?.app??{}),linked_to:null,dev:false}}; u.release={version:"99.0.0",url:"https://example.com",published_at:new Date().toISOString(),notes:"- a thing",channel:"stable",action:"update",downgrade:false,cli_behind:true,app_behind:true,cli_ahead:false,app_ahead:false}; u.showWhatsNew();`,
		teardown: `${A}.updates.whatsNewOpen=false; ${A}.updates.release=null;`,
	},
	{
		id: "update-pill",
		setup: `const u=${A}.updates; u.prefs={...u.prefs,skipped:null}; u.info={...(u.info??{}),cli:{...(u.info?.cli??{}),linked_to:null},app:{...(u.info?.app??{}),linked_to:null,dev:false}}; u.release={version:"99.0.0",url:"https://example.com",published_at:new Date().toISOString(),notes:"x",channel:"stable",action:"update",downgrade:false,cli_behind:true,app_behind:true,cli_ahead:false,app_ahead:false};`,
		teardown: `${A}.updates.release=null;`,
		selector: "aside.sidebar",
	},
	{
		id: "dialog-confirm",
		setup: `${ASK}("Delete everything?",{description:"This cannot be undone.",confirmLabel:"Delete",destructive:true});`,
		teardown: `${A}.ask.current?.resolve(false); ${A}.ask.current=null;`,
	},
	{
		id: "dialog-prompt",
		setup: `${A}.promptDialog("Rename worktree",{value:"main",placeholder:"name",description:"Pick a name",confirmLabel:"Rename"});`,
		teardown: `${A}.ask.current?.resolve(null); ${A}.ask.current=null;`,
	},
	{
		id: "dialog-discover",
		setup: `${A}.discovery.show();`,
		teardown: `${A}.discovery.open=false;`,
	},
	{
		id: "toasts",
		setup: `const k=${A}.toast; k.success("Copied http://localhost:4101"); k.info("api started"); k.warning("Slow query detected"); k.error("api failed to start"); await new Promise(r=>setTimeout(r,500));`,
	},
	{
		id: "menu-worktree-row",
		setup: `${selectWt} ${press("[aria-label='Worktree menu'], [aria-label='Project menu']")}`,
		wait: "document.querySelector('[role=menu]')",
	},
	{
		id: "menu-project",
		setup: `${selectWt} ${press("[aria-label='Project menu']")}`,
		wait: "document.querySelector('[role=menu]')",
	},
	{
		id: "menu-new-tab",
		setup: `${selectWt} ${press("[aria-label='New tab']")}`,
		wait: "document.querySelector('[role=menu]')",
	},
	{
		id: "tooltip",
		setup: `${selectWt} const e=document.querySelector("[aria-label='New worktree'],[aria-label='New tab']"); e?.dispatchEvent(new PointerEvent("pointerenter",{bubbles:true,pointerType:"mouse"})); e?.dispatchEvent(new MouseEvent("mouseover",{bubbles:true})); e?.focus?.(); await new Promise(r=>setTimeout(r,900));`,
	},
	{
		id: "focus-ring",
		setup: `window.dispatchEvent(new KeyboardEvent("keydown",{key:"Tab",code:"Tab",bubbles:true})); document.documentElement.dataset.kbd=""; document.querySelector("aside.sidebar button, aside.sidebar [role=button]")?.focus();`,
	},
	{
		// Settings → Appearance → Import theme…: a real click on the button the user presses
		id: "dialog-theme-import",
		setup: `${A}.updates.show("appearance/appearance"); await new Promise(r=>setTimeout(r,600)); const b=[...document.querySelectorAll("button")].find(b=>/^\\s*Import…/.test(b.textContent??"")); if(!b) throw new Error("no Import… button"); b.click();`,
		wait: "document.querySelector('[role=dialog] textarea, [role=dialog] [data-dropzone], [role=dialog]')",
		teardown: `${chord("Escape", {})}; ${A}.updates.open=false;`,
	},
	{
		// The first-run checklist (state cleared so it shows) with its progress
		id: "checklist",
		setup: `${A}.onboarding.state={...${A}.onboarding.state,done:true,checklistDismissed:false,items:{}};`,
	},
	{
		id: "tour",
		setup: `${A}.onboarding.tourOpen=true;`,
		teardown: `${A}.onboarding.tourOpen=false;`,
	},
	{
		id: "shortcuts-sheet",
		setup: `${A}.onboarding.helpOpen=true;`,
		teardown: `${A}.onboarding.helpOpen=false;`,
	},
];
/**
 * Bring the page to rest: finish every finite animation and transition. A sheet or menu mid-fade is text at a fraction
 * of its colour, and in a page the OS reports as hidden (an agent window) animations do not advance at all (a kit
 * drawer stayed at its 0.6 start opacity forever). `finish()` jumps to the end state, which is what a user sees at
 * rest; infinite ones (spinners, skeleton pulses) are left running. No rAF: it never fires in a hidden page.
 */
const SETTLE = `for (const a of document.getAnimations()) if (a.effect?.getComputedTiming().iterations !== Infinity) { try { a.finish(); } catch {} } return true`;
const only = arg("screens")?.split(",");
const themes = arg("themes")
	?.split(",")
	.map((s) => s.trim());

// --- run -------------------------------------------------------------------------------------------------------
type Fail = {
	selector: string;
	text: string;
	ratio: number;
	required: number;
	fg: string;
	bg: string;
	vars: Record<string, string>;
};
type Cell = {
	theme: string;
	screen: string;
	checked: number;
	failures: Fail[];
	unknown: number;
	error?: string;
};
type NonText = { selector: string; kind: string; ratio: number; required: number; fg: string; bg: string };
/** The non-text audit (icons, field borders, focus ring) over the same root the text audit used. */
const nonText = (selector?: string) =>
	evalJs(
		`const root=${selector ? `document.querySelector(${JSON.stringify(selector)})` : "document.body"}; if(!root) throw new Error("no root"); return window.__atlasDebug.nonTextAudit(root);`,
	) as { checked: number; failures: NonText[] };
const cells: Cell[] = [];
const stop = () =>
	flag("attach") ||
	sh(["bun", "run", "desktop:agent", "--", "--stop", "--name", NAME]);
process.on("uncaughtException", (e) => {
	stop();
	throw e;
});

// The welcome stage only exists with no projects: audit it per theme before the fixture project is added.
// Incident 2026-10-13: light themes painted the welcome copy dark grey on the night sky; the canvas is not a CSS
// background, so the hero declares it (data-contrast-bg) and this pass must check its text, not skip it.
for (const t of THEMES.filter((t) => !themes || themes.includes(t.name))) {
	if (only && !only.includes("welcome")) break;
	evalJs(
		`await ${A}.themes.setTheme({mode:${JSON.stringify(t.mode)},${t.mode}:${JSON.stringify(t.name)}}); return true`,
	);
	await sleep(500);
	try {
		dbg(
			"wait",
			"document.querySelector('.hero .stage h1, .hero .stage p')",
			"--expr",
			"--timeout",
			"8000",
		);
		evalJs(SETTLE);
		const r = JSON.parse(dbg("contrast", ".hero"));
		cells.push({
			theme: t.name,
			screen: "welcome",
			checked: r.checked,
			failures: r.failures,
			unknown: r.unknown.length,
			error:
				r.checked < 2
					? "welcome copy was not audited (no text checked)"
					: undefined,
		});
	} catch (e) {
		cells.push({
			theme: t.name,
			screen: "welcome",
			checked: 0,
			failures: [],
			unknown: 0,
			error: String(e).slice(-300),
		});
	}
}

evalJs(`return await ${A}.api.add(${JSON.stringify(root)}).then(()=>true)`);
await sleep(800);

for (const t of THEMES.filter((t) => !themes || themes.includes(t.name))) {
	evalJs(
		`await ${A}.themes.setTheme({mode:${JSON.stringify(t.mode)},${t.mode}:${JSON.stringify(t.name)}}); return document.documentElement.dataset.atlasTheme`,
	);
	await sleep(500);
	for (const s of SCREENS.filter((s) => !only || only.includes(s.id))) {
		try {
			evalJs(`${s.setup}; return true`);
			if (s.wait) dbg("wait", s.wait, "--expr", "--timeout", "8000");
			await sleep(400);
			evalJs(SETTLE);
			const r = JSON.parse(
				dbg("contrast", ...(s.selector ? [s.selector] : [])),
			);
			const nt = nonText(s.selector);
			cells.push({
				theme: t.name,
				screen: s.id,
				checked: r.checked + nt.checked,
				failures: [
					...r.failures,
					...nt.failures.map((f: NonText) => ({
						selector: `[${f.kind}] ${f.selector}`,
						text: f.kind,
						ratio: f.ratio,
						required: f.required,
						fg: f.fg,
						bg: f.bg,
						vars: {},
					})),
				],
				unknown: r.unknown.length,
			});
		} catch (e) {
			cells.push({
				theme: t.name,
				screen: s.id,
				checked: 0,
				failures: [],
				unknown: 0,
				error: String(e).slice(-300),
			});
		} finally {
			if (s.teardown) evalJs(`${s.teardown}; return true`);
			else evalJs(`${chord("Escape", {})}; return true`);
			await sleep(200);
		}
	}
}

// --- report ----------------------------------------------------------------------------------------------------
const total = cells.reduce((n, c) => n + c.failures.length, 0);
const errors = cells.filter((c) => c.error);
const rows = THEMES.filter((t) => cells.some((c) => c.theme === t.name));
const screens = [...new Set(cells.map((c) => c.screen))];
let md = `| theme | ${screens.join(" | ")} | total |\n|---|${screens.map(() => "---:").join("|")}|---:|\n`;
for (const t of rows) {
	const mine = cells.filter((c) => c.theme === t.name);
	md += `| ${t.name} | ${screens.map((s) => mine.find((c) => c.screen === s)?.failures.length ?? "-").join(" | ")} | ${mine.reduce((n, c) => n + c.failures.length, 0)} |\n`;
}
const bySel = new Map<
	string,
	{ count: number; worst: number; required: number; sample: string }
>();
for (const c of cells)
	for (const f of c.failures) {
		const k = f.selector.replace(/\.svelte-[a-z0-9]+/g, "");
		const e = bySel.get(k) ?? {
			count: 0,
			worst: 99,
			required: f.required,
			sample: f.text,
		};
		e.count++;
		e.worst = Math.min(e.worst, f.ratio);
		bySel.set(k, e);
	}
md += `\nTop offenders (selector, count, worst ratio / required):\n`;
for (const [k, e] of [...bySel]
	.sort((a, b) => b[1].count - a[1].count)
	.slice(0, 25))
	md += `- ${e.count}x ${e.worst} / ${e.required}  \`${k}\`  "${e.sample}"\n`;
const unknownTotal = cells.reduce((n, c) => n + c.unknown, 0);
md += `\nText runs on a background the audit could not resolve (image/gradient; not a pass): ${unknownTotal}\n`;
if (errors.length)
	md += `\nScreens that could not be audited:\n${errors.map((c) => `- ${c.theme} / ${c.screen}: ${c.error}`).join("\n")}\n`;
console.log(md);
if (arg("json")) writeFileSync(arg("json")!, JSON.stringify(cells, null, 1));
if (arg("md")) writeFileSync(arg("md")!, md);

stop();
console.log(
	total === 0 && errors.length === 0
		? "contrast audit: 0 failures"
		: `contrast audit: ${total} failures, ${errors.length} screens not audited`,
);
process.exit(total === 0 && errors.length === 0 ? 0 : 1);
