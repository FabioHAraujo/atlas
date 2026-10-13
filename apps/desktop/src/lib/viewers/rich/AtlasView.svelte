<script lang="ts">
	import {
		Play,
		RotateCw,
		Square,
		TriangleAlert,
		CircleCheck,
		Cable,
		Zap,
		ArrowRight,
		Loader,
	} from "@lucide/svelte";
	import { api, errText } from "#lib/api.ts";
	import { store } from "#lib/stores/projects.svelte.ts";
	import { ws } from "#lib/stores/workspace.svelte.ts";
	import { parseData } from "#lib/viewers/rich/data.ts";
	import { atlasModel, lineOfKey } from "#lib/viewers/rich/atlas.ts";
	import type { Problem } from "#lib/api.ts";
	import type { RichCtx } from "#lib/viewers/rich/ctx.ts";
	import StatusDot, { type DotTone } from "#lib/panel/StatusDot.svelte";
	import Copy from "#lib/viewers/rich/Copy.svelte";
	import "#lib/viewers/rich/rich.css";

	let { ctx }: { ctx: RichCtx } = $props();

	let parsed = $derived(parseData(ctx.text, "yaml"));
	let m = $derived(parsed.ok ? atlasModel(parsed.value) : null);
	let isLocal = $derived(/atlas\.local\./.test(ctx.path));

	// The project this worktree belongs to (a linked checkout is its own project, rooted at the worktree).
	let project = $derived.by(() => {
		const w = ws.worktree(ctx.worktreeId);
		return (
			store.projects.find((p) => p.root === w?.path) ?? store.projects.find((p) => p.id === w?.repoId) ?? null
		);
	});
	let live = $derived(project ? store.live[project.id] : undefined);
	let running = $derived(!!project?.running);
	const svc = (name: string) => live?.services.find((s) => s.name === name);

	let problems = $state<Problem[]>([]);
	let validating = $state(false);
	// Live validation through the same loader the CLI uses (300 ms debounce). The base file is validated
	// as shown; atlas.local.yaml is validated through the project (it merges onto the on-disk atlas.yaml).
	$effect(() => {
		const t = ctx.text;
		const p = project;
		if (!p || isLocal || !parsed.ok) {
			problems = [];
			return;
		}
		validating = true;
		let live = true;
		const timer = setTimeout(async () => {
			const r = await api
				.configValidate(p.id, t)
				.catch((e): Problem[] => [{ path: "", message: errText(e) }]);
			if (live) {
				problems = r;
				validating = false;
			}
		}, 300);
		return () => {
			live = false;
			clearTimeout(timer);
		};
	});

	const tone = (s: string | undefined): DotTone =>
		!s
			? "off"
			: s === "running"
				? "ok"
				: s === "starting"
					? "run"
					: s === "failed" || s === "crashed"
						? "fail"
						: s === "stopped"
							? "off"
							: "warn";
	const problemsFor = (name: string) =>
		problems.filter((p) => p.path.includes(`services.${name}`) || p.path.split(".").includes(name));
	const general = $derived(problems.filter((p) => !m?.services.some((s) => problemsFor(s.name).includes(p))));
	const act = (cmd: "start_service" | "stop_service" | "restart_service", name: string) =>
		project && store.run(`svc:${project.id}:${name}`, () => api.service(project.id, cmd, name));
	const busy = (name: string) => !!(project && store.busy[`svc:${project.id}:${name}`]);
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
					<Zap size={18} />
					<h1>{m.name ?? (isLocal ? "Local overrides" : "atlas.yaml")}</h1>
					<span class="rv-ver"
						>{m.services.length} service{m.services.length === 1 ? "" : "s"} · {m.actions.length} action{m
							.actions.length === 1
							? ""
							: "s"}</span
					>
				</div>
				<div class="rv-facts">
					{#if isLocal}<span class="rv-chip info">local, not committed</span>{/if}
					{#if project}
						<span class="rv-chip" class:ok={running}
							><StatusDot tone={running ? "ok" : "off"} /> {running ? "Stack running" : "Stack stopped"}</span
						>
					{/if}
					{#if validating}
						<span class="rv-chip"><Loader size={10} class="spin" /> Validating</span>
					{:else if !isLocal && project}
						{#if problems.length}
							<span class="rv-chip bad"
								><TriangleAlert size={10} /> {problems.length} problem{problems.length === 1 ? "" : "s"}</span
							>
						{:else}
							<span class="rv-chip ok"><CircleCheck size={10} /> Valid</span>
						{/if}
					{/if}
					{#if m.preCommand}<span class="rv-chip mono" title="pre_command">pre: {m.preCommand}</span>{/if}
				</div>
			</header>

			{#if general.length}
				<section class="rv-sec">
					<h2><TriangleAlert size={13} /> Validation <span class="n">{general.length}</span></h2>
					<div class="rv-list">
						{#each general as p (p.path + p.message)}
							{@const line = lineOfKey(ctx.text, p.path)}
							<div class="rv-row bad">
								{#if p.path}<span class="rv-k">{p.path}</span>{/if}
								<span class="rv-v wrap">{p.message}</span>
								{#if line}<button class="rv-btn" onclick={() => ctx.toSource(line)}>Line {line}</button>{/if}
							</div>
						{/each}
					</div>
				</section>
			{/if}

			{#each m.unknownDeps as u (u.service + u.dep)}
				<div class="rv-banner warn">
					<TriangleAlert size={14} />
					{u.service} waits for {u.dep}, which is not defined here{isLocal
						? " (it may live in atlas.yaml)"
						: ""}.
				</div>
			{/each}

			{#if m.order.length > 1 && m.services.some((s) => s.dependsOn.length)}
				<section class="rv-sec">
					<h2>Start order</h2>
					<div class="order">
						{#each m.order as n, i (n)}
							<span class="node">{n}</span>
							{#if i < m.order.length - 1}<ArrowRight size={11} class="arrow" />{/if}
						{/each}
					</div>
				</section>
			{/if}

			{#if m.services.length}
				<section class="rv-sec">
					<h2>Services <span class="n">{m.services.length}</span></h2>
					<div class="rv-list">
						{#each m.services as s (s.name)}
							{@const st = svc(s.name)}
							{@const probs = problemsFor(s.name)}
							<div class="svc" class:off={!s.enabled}>
								<div class="rv-row head" class:bad={probs.length > 0}>
									<StatusDot tone={running ? tone(st?.state) : "off"} pulse={st?.state === "starting"} />
									<span class="rv-k">{s.name}</span>
									{#if s.port}<span class="rv-chip info mono">:{s.port}</span>{/if}
									{#if s.critical}<span class="rv-chip warn">critical</span>{/if}
									{#if !s.enabled}<span class="rv-chip">disabled</span>{/if}
									{#if s.hideLogs}<span class="rv-chip">no log tab</span>{/if}
									{#if st && running}<span class="rv-note"
											>{st.state}{st.restarts ? ` · ${st.restarts} restarts` : ""}</span
										>{/if}
									<span class="rv-v" title={s.command ?? ""}>{s.command ?? "container / external"}</span>
									{#if running}
										<button
											class="rv-btn run"
											disabled={busy(s.name) || st?.state === "running"}
											title="Start {s.name}"
											onclick={() => act("start_service", s.name)}><Play size={11} /> Start</button
										>
										<button
											class="rv-btn"
											disabled={busy(s.name)}
											title="Restart {s.name}"
											onclick={() => act("restart_service", s.name)}><RotateCw size={11} /> Restart</button
										>
										<button
											class="rv-btn icon"
											disabled={busy(s.name) || st?.state === "stopped"}
											title="Stop {s.name}"
											aria-label="Stop {s.name}"
											onclick={() => act("stop_service", s.name)}><Square size={11} /></button
										>
									{/if}
								</div>
								<div class="meta">
									{#if s.dir}<span class="rv-chip mono">dir {s.dir}</span>{/if}
									{#if s.health}<span class="rv-chip ok mono" title="Health URL">health {s.health}</span>{/if}
									{#each s.dependsOn as d (d.name)}
										<span class="rv-chip" class:warn={m.unknownDeps.some((u) => u.dep === d.name)}
											>waits for {d.name}{d.condition ? ` · ${d.condition}` : ""}</span
										>
									{/each}
									{#if s.env.length}<span class="rv-chip mono" title={s.env.join(", ")}
											>{s.env.length} env</span
										>{/if}
								</div>
								{#each probs as p (p.path + p.message)}
									{@const line = lineOfKey(ctx.text, p.path)}
									<div class="prob">
										<TriangleAlert size={11} />
										<span class="pk">{p.path.split(".").slice(2).join(".") || p.path}</span>
										{p.message}
										{#if line}<button class="rv-btn" onclick={() => ctx.toSource(line)}>Line {line}</button
											>{/if}
									</div>
								{/each}
							</div>
						{/each}
					</div>
				</section>
			{/if}

			{#if m.actions.length}
				<section class="rv-sec">
					<h2>Actions <span class="n">{m.actions.length}</span></h2>
					<div class="rv-list">
						{#each m.actions as a (a.key + a.label)}
							<div class="rv-row">
								<kbd>{a.key}</kbd>
								<span class="rv-k">{a.label}</span>
								{#if a.group}<span class="rv-chip">{a.group}</span>{/if}
								{#if a.confirm}<span class="rv-chip warn" title={a.confirm}>asks first</span>{/if}
								{#if a.session}<span class="rv-chip info">session</span>{/if}
								<span class="rv-v" title={a.command}>{a.command}</span>
								<Copy text={a.command} label="Copy command" />
							</div>
						{/each}
					</div>
				</section>
			{/if}

			{#if m.tunnel}
				<section class="rv-sec">
					<h2><Cable size={13} /> Tunnel</h2>
					<div class="rv-list">
						<div class="rv-row">
							<span class="rv-chip" class:ok={m.tunnel.enabled}
								>{m.tunnel.enabled ? "enabled" : "disabled"}</span
							>
							<span class="rv-k">localhost:{m.tunnel.local}</span>
							<ArrowRight size={11} />
							<span class="rv-v">{m.tunnel.remote} via {m.tunnel.ssh}</span>
							{#if live?.tunnel}<span class="rv-chip" class:ok={live.tunnel.state === "up"}
									>{live.tunnel.state}</span
								>{/if}
						</div>
					</div>
				</section>
			{/if}

			{#if m.infra.length || m.envFiles.length || m.deployHosts.length}
				<section class="rv-sec">
					<h2>Also configured</h2>
					<div class="rv-facts">
						{#each m.infra as i (i)}<span class="rv-chip mono">infra {i}</span>{/each}
						{#each m.envFiles as f (f)}<span class="rv-chip acc mono">env file {f}</span>{/each}
						{#each m.deployHosts as h (h)}<span class="rv-chip info mono">deploy {h}</span>{/each}
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
		font-family: var(--mono);
		font-size: 11.5px;
		padding: 3px 9px;
		border-radius: 7px;
		border: 0.5px solid var(--rv-line);
	}
	.svc {
		border-bottom: 0.5px solid var(--rv-line);
	}
	.svc:last-child {
		border-bottom: 0;
	}
	.svc.off {
		color: var(--ca-text-secondary);
	}
	.head {
		border-bottom: 0;
	}
	.meta {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
		padding: 0 12px 8px 29px;
	}
	.meta:empty {
		display: none;
	}
	.pk {
		font-family: var(--mono);
		font-weight: 600;
	}
	.prob {
		display: flex;
		align-items: center;
		gap: 5px;
		padding: 0 12px 8px 29px;
		font-size: 11.5px;
		color: var(--rv-bad);
	}
	kbd {
		font-family: var(--mono);
		font-size: 11px;
		min-width: 20px;
		text-align: center;
		padding: 1px 5px;
		border-radius: 5px;
		border: 0.5px solid var(--rv-line);
		color: var(--ca-text-secondary);
	}
	.sp {
		flex: 1;
	}
	:global(.spin) {
		animation: spin 1s linear infinite;
	}
	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
