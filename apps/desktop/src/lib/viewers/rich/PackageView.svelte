<script lang="ts">
	import { onMount } from "svelte";
	import { Play, ExternalLink, Package, Boxes, Search, TriangleAlert } from "@lucide/svelte";
	import { host } from "#lib/host.ts";
	import { api } from "#lib/api.ts";
	import { fileType } from "#lib/viewers/fileType.ts";
	import {
		detectPackageManager,
		manifestFor,
		npmManifest,
		runScriptArgv,
		type Manifest,
	} from "#lib/viewers/rich/manifest.ts";
	import { parseData } from "#lib/viewers/rich/data.ts";
	import { runInTerminal } from "#lib/viewers/rich/run.ts";
	import type { RichCtx } from "#lib/viewers/rich/ctx.ts";
	import Copy from "#lib/viewers/rich/Copy.svelte";
	import "#lib/viewers/rich/rich.css";

	let { ctx }: { ctx: RichCtx } = $props();

	let id = $derived(fileType(ctx.path).id);
	let result = $derived.by((): { manifest: Manifest } | { error: string; line?: number } => {
		if (id === "package-json") {
			const p = parseData(ctx.text, "json");
			return p.ok ? { manifest: npmManifest(p.value) } : { error: p.error, line: p.line };
		}
		return manifestFor(id, ctx.text);
	});
	let m = $derived("manifest" in result ? result.manifest : null);
	let siblings = $state<string[]>([]);
	let q = $state("");
	let pm = $derived(
		detectPackageManager(siblings, m?.facts.find((f) => f.label === "Package manager")?.value),
	);

	onMount(() => {
		const dir = ctx.path.split("/").slice(0, -1).join("/");
		void host
			.fsList(`${ctx.root}/${dir}`)
			.then((r) => (siblings = r.map((e) => e.name)))
			.catch(() => {});
	});

	const needle = $derived(q.trim().toLowerCase());
	const match = (s: string) => !needle || s.toLowerCase().includes(needle);
	const url = (kind: Manifest["kind"], name: string, registry: string) =>
		kind === "go" ? `${registry}${name}` : `${registry}${encodeURIComponent(name).replace(/%2F/g, "/")}`;
	const pmLabel = $derived(
		id === "package-json" || id === "composer" ? (id === "composer" ? "composer" : pm) : "",
	);
	const argvFor = (script: string) =>
		id === "composer" ? ["composer", "run-script", script] : runScriptArgv(pm, script);
	const runnable = $derived(id === "package-json" || id === "composer");
</script>

<div class="rv">
	<div class="rv-inner">
		{#if "error" in result}
			<div class="rv-banner bad">
				<TriangleAlert size={14} /> Cannot parse: {result.error}
				<span class="sp"></span>
				<button class="rv-btn" onclick={() => ctx.toSource(result.line)}>Open as source</button>
			</div>
		{:else if m}
			<header class="rv-head">
				<div class="rv-title">
					<Package size={18} />
					<h1>{m.name || ctx.path.split("/").pop()}</h1>
					{#if m.version}<span class="rv-ver">{m.version}</span>{/if}
					{#if m.license}<span class="rv-chip">{m.license}</span>{/if}
				</div>
				{#if m.description}<p class="rv-desc">{m.description}</p>{/if}
				<div class="rv-facts">
					{#each m.facts as f (f.label)}
						<span class="rv-chip"><b>{f.label}</b> {f.value}</span>
					{/each}
					{#each m.links as l (l.url)}
						<button class="rv-chip acc link" onclick={() => api.openUrl(l.url)}
							><ExternalLink size={10} /> {l.label}</button
						>
					{/each}
					{#if m.name && m.kind !== "go"}
						<button class="rv-chip acc link" onclick={() => api.openUrl(url(m.kind, m.name, m.registry))}
							><ExternalLink size={10} /> Registry</button
						>
					{/if}
				</div>
			</header>

			{#if m.scripts.length}
				<section class="rv-sec">
					<h2>
						{m.kind === "cargo" ? "Features" : m.kind === "python" ? "Entry points" : "Scripts"}
						<span class="n">{m.scripts.length}</span>
						<span class="sp"></span>
						{#if runnable}<span class="rv-note">runs with {pmLabel}</span>{/if}
					</h2>
					<div class="rv-list">
						{#each m.scripts as s (s.name)}
							<div class="rv-row">
								<span class="rv-k">{s.name}</span>
								<span class="rv-v" title={s.command}>{s.command}</span>
								{#if runnable}
									<button
										class="rv-btn run"
										title="Run in a terminal"
										onclick={() => runInTerminal(ctx.worktreeId, ctx.path, argvFor(s.name), s.name)}
									>
										<Play size={11} /> Run
									</button>
								{/if}
								<Copy text={runnable ? argvFor(s.name).join(" ") : s.command} label="Copy command" />
							</div>
						{/each}
					</div>
				</section>
			{/if}

			{#if m.workspaces.length}
				<section class="rv-sec">
					<h2><Boxes size={13} /> Workspaces <span class="n">{m.workspaces.length}</span></h2>
					<div class="rv-facts">
						{#each m.workspaces as w (w)}<span class="rv-chip mono">{w}</span>{/each}
					</div>
				</section>
			{/if}

			{#each m.groups as g, gi (g.title)}
				{@const list = g.deps.filter((d) => match(d.name))}
				<section class="rv-sec">
					<h2>
						{g.title}
						<span class="n">{g.deps.length}</span>
						<span class="sp"></span>
						{#if gi === 0}
							<label class="rv-search">
								<Search size={12} />
								<input placeholder="Filter dependencies" bind:value={q} aria-label="Filter dependencies" />
							</label>
						{/if}
					</h2>
					{#if list.length}
						<div class="rv-list">
							{#each list as d (d.name)}
								<div class="rv-row">
									<span class="rv-k">{d.name}</span>
									<span class="rv-chip mono">{d.range}</span>
									{#if d.note}<span class="rv-note">{d.note}</span>{/if}
									<span class="rv-v"></span>
									{#if m.kind !== "go" || d.name.includes(".")}
										<button
											class="rv-btn icon"
											title="Open on the registry"
											aria-label="Open {d.name} on the registry"
											onclick={() => api.openUrl(url(m.kind, d.name, m.registry))}
										>
											<ExternalLink size={12} />
										</button>
									{/if}
								</div>
							{/each}
						</div>
					{:else}
						<div class="rv-list"><div class="rv-empty">No match</div></div>
					{/if}
				</section>
			{/each}
		{/if}
	</div>
</div>

<style>
	b {
		font-weight: 600;
		color: var(--ca-text-primary);
		margin-right: 2px;
	}
	.link {
		border: 0;
		cursor: pointer;
		font: inherit;
		font-size: 11px;
	}
	.link:hover {
		filter: brightness(1.15);
	}
</style>
