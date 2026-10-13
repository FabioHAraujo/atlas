<script lang="ts">
	import {
		Container,
		Hammer,
		Network,
		HardDrive,
		Variable,
		ArrowRight,
		TriangleAlert,
		HeartPulse,
		Play,
	} from "@lucide/svelte";
	import { parseData } from "#lib/viewers/rich/data.ts";
	import { composeModel } from "#lib/viewers/rich/compose.ts";
	import { runInTerminal } from "#lib/viewers/rich/run.ts";
	import type { RichCtx } from "#lib/viewers/rich/ctx.ts";
	import "#lib/viewers/rich/rich.css";

	let { ctx }: { ctx: RichCtx } = $props();

	let parsed = $derived(parseData(ctx.text, "yaml"));
	let m = $derived(parsed.ok ? composeModel(parsed.value) : null);
	let focus = $state<string | null>(null);
	/** Services the focused one waits for, and the ones waiting for it. */
	let related = $derived.by(() => {
		if (!m || !focus) return new Set<string>();
		const s = m.services.find((x) => x.name === focus);
		const up = s?.dependsOn.map((d) => d.name) ?? [];
		const down = m.services.filter((x) => x.dependsOn.some((d) => d.name === focus)).map((x) => x.name);
		return new Set([focus, ...up, ...down]);
	});
	const dim = (n: string) => !!focus && !related.has(n);
	const run = (args: string[], label: string) =>
		runInTerminal(
			ctx.worktreeId,
			ctx.path,
			["docker", "compose", "-f", ctx.path.split("/").pop()!, ...args],
			label,
		);
</script>

<div class="rv">
	<div class="rv-inner">
		{#if !parsed.ok}
			<div class="rv-banner bad">
				<TriangleAlert size={14} /> Cannot parse: {parsed.error}
				<span class="sp"></span>
				<button class="rv-btn" onclick={() => ctx.toSource(parsed.line)}>Open as source</button>
			</div>
		{:else if m}
			<header class="rv-head">
				<div class="rv-title">
					<Container size={18} />
					<h1>{m.name ?? ctx.path.split("/").pop()}</h1>
					<span class="rv-ver">{m.services.length} service{m.services.length === 1 ? "" : "s"}</span>
				</div>
				<div class="rv-facts">
					{#if m.volumes.length}<span class="rv-chip"
							><HardDrive size={10} /> {m.volumes.length} volume{m.volumes.length === 1 ? "" : "s"}</span
						>{/if}
					{#if m.networks.length}<span class="rv-chip"><Network size={10} /> {m.networks.join(", ")}</span
						>{/if}
					<span class="sp"></span>
					<button class="rv-btn run" onclick={() => run(["up"], "compose up")}><Play size={11} /> Up</button>
					<button class="rv-btn" onclick={() => run(["ps"], "compose ps")}>Status</button>
				</div>
			</header>

			{#each m.unknownDeps as u (u.service + u.dep)}
				<div class="rv-banner warn">
					<TriangleAlert size={14} />
					{u.service} depends on {u.dep}, which is not a service here.
				</div>
			{/each}

			{#if m.services.some((s) => s.dependsOn.length)}
				<section class="rv-sec">
					<h2>Start order</h2>
					<div class="order">
						{#each m.order as n, i (n)}
							<button
								class="node"
								class:on={focus === n}
								class:dim={dim(n)}
								onclick={() => (focus = focus === n ? null : n)}>{n}</button
							>
							{#if i < m.order.length - 1}<ArrowRight size={11} class="arrow" />{/if}
						{/each}
					</div>
				</section>
			{/if}

			<section class="rv-sec">
				<h2>Services</h2>
				<div class="grid">
					{#each m.services as s (s.name)}
						<article class="card" class:dim={dim(s.name)} class:on={focus === s.name}>
							<header>
								<button class="nm" onclick={() => (focus = focus === s.name ? null : s.name)}>{s.name}</button
								>
								{#if s.healthcheck}<span class="rv-chip ok" title="Has a healthcheck"
										><HeartPulse size={10} /></span
									>{/if}
								{#if s.restart}<span class="rv-chip">{s.restart}</span>{/if}
								{#each s.profiles as p (p)}<span class="rv-chip info">{p}</span>{/each}
							</header>
							<div class="src">
								{#if s.image}<span class="rv-chip mono"><Container size={10} /> {s.image}</span>{/if}
								{#if s.build}<span class="rv-chip mono"><Hammer size={10} /> build {s.build}</span>{/if}
							</div>
							{#if s.command}<code class="cmd" title={s.command}>{s.command}</code>{/if}
							{#if s.ports.length}
								<div class="grp">
									<span class="lbl">Ports</span>{#each s.ports as p (p)}<span class="rv-chip info mono"
											>{p}</span
										>{/each}
								</div>
							{/if}
							{#if s.volumes.length}
								<div class="grp">
									<span class="lbl">Volumes</span>{#each s.volumes as v (v)}<span class="rv-chip mono"
											>{v}</span
										>{/each}
								</div>
							{/if}
							{#if s.env.length || s.envFiles.length}
								<div class="grp">
									<span class="lbl"><Variable size={10} /> Env</span>
									{#each s.envFiles as f (f)}<span class="rv-chip acc mono">{f}</span>{/each}
									{#each s.env.slice(0, 8) as e (e)}<span class="rv-chip mono" title={e}
											>{e.split("=")[0]}</span
										>{/each}
									{#if s.env.length > 8}<span class="rv-note">+{s.env.length - 8}</span>{/if}
								</div>
							{/if}
							{#if s.dependsOn.length}
								<div class="grp">
									<span class="lbl">Waits for</span>
									{#each s.dependsOn as d (d.name)}
										<span class="rv-chip" class:warn={m.unknownDeps.some((u) => u.dep === d.name)}
											>{d.name}{d.condition ? ` · ${d.condition.replace("service_", "")}` : ""}</span
										>
									{/each}
								</div>
							{/if}
						</article>
					{/each}
				</div>
			</section>

			{#if m.volumes.length}
				<section class="rv-sec">
					<h2>Named volumes <span class="n">{m.volumes.length}</span></h2>
					<div class="rv-facts">
						{#each m.volumes as v (v)}<span class="rv-chip mono">{v}</span>{/each}
					</div>
				</section>
			{/if}
		{/if}
	</div>
</div>

<style>
	.order {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}
	.order :global(.arrow) {
		color: var(--ca-text-disabled);
	}
	.node {
		font: inherit;
		font-family: var(--mono);
		font-size: 11.5px;
		padding: 3px 9px;
		border-radius: 7px;
		border: 0.5px solid var(--rv-line);
		background: none;
		color: var(--ca-text-primary);
		cursor: pointer;
	}
	.node.on {
		border-color: var(--rv-acc);
		color: var(--rv-acc);
		background: color-mix(in oklab, var(--rv-acc) 10%, transparent);
	}
	.dim {
		color: var(--ca-text-secondary);
	}
	.grid {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
		gap: 10px;
	}
	.card {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 11px 12px;
		border: 0.5px solid var(--rv-line);
		border-radius: 10px;
		min-width: 0;
		transition: opacity var(--dur-fast, 120ms) var(--ease, ease);
	}
	.card.on {
		border-color: color-mix(in oklab, var(--rv-acc) 60%, transparent);
	}
	.card header {
		display: flex;
		align-items: center;
		gap: 6px;
		flex-wrap: wrap;
	}
	.nm {
		border: 0;
		background: none;
		padding: 0;
		margin-right: auto;
		font: inherit;
		font-size: 13.5px;
		font-weight: 650;
		color: var(--ca-text-primary);
		cursor: pointer;
	}
	.src,
	.grp {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 5px;
	}
	.lbl {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 10.5px;
		color: var(--ca-text-secondary);
		width: 52px;
		flex: none;
	}
	.cmd {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--ca-text-secondary);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.sp {
		flex: 1;
	}
</style>
