<script lang="ts">
	import { FileCog, TriangleAlert, ArrowDown, Search } from "@lucide/svelte";
	import { host, b64bytes } from "#lib/host.ts";
	import { openFile } from "#lib/stores/files.svelte.ts";
	import {
		extendsCandidates,
		resolveTsconfig,
		TS_DOCS,
		type TsConfigModel,
	} from "#lib/viewers/rich/tsconfig.ts";
	import type { RichCtx } from "#lib/viewers/rich/ctx.ts";
	import "#lib/viewers/rich/rich.css";

	let { ctx }: { ctx: RichCtx } = $props();

	let model = $state<TsConfigModel | null>(null);
	let q = $state("");

	// Re-resolve whenever the text changes: the file itself is read from the buffer, bases from disk.
	$effect(() => {
		const text = ctx.text;
		const self = ctx.path;
		let live = true;
		const read = async (p: string) => {
			if (p === self) return text;
			try {
				const r = await host.fsRead(`${ctx.root}/${p}`, 512 * 1024);
				return new TextDecoder().decode(b64bytes(r.data));
			} catch {
				return null;
			}
		};
		void resolveTsconfig(self, read, extendsCandidates).then((m) => {
			if (live) model = m;
		});
		return () => (live = false);
	});

	let opts = $derived(
		model?.options.filter(
			(o) =>
				!q ||
				o.key.toLowerCase().includes(q.toLowerCase()) ||
				(TS_DOCS[o.key] ?? "").toLowerCase().includes(q.toLowerCase()),
		) ?? [],
	);
	const fmt = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
	const local = (p: string) => !p.startsWith("node_modules/") && !p.startsWith("@");
</script>

<div class="rv">
	<div class="rv-inner">
		{#if model?.error}
			<div class="rv-banner bad">
				<TriangleAlert size={14} /> Cannot parse: {model.error}
				<span class="sp"></span>
				<button class="rv-btn" onclick={() => ctx.toSource()}>Open as source</button>
			</div>
		{:else if model}
			<header class="rv-head">
				<div class="rv-title">
					<FileCog size={18} />
					<h1>{ctx.path.split("/").pop()}</h1>
					<span class="rv-ver"
						>{model.options.length} effective option{model.options.length === 1 ? "" : "s"}</span
					>
				</div>
			</header>

			{#if model.chain.length > 1}
				<section class="rv-sec">
					<h2>Extends chain <span class="n">base first</span></h2>
					<div class="chain">
						{#each model.chain as l, i (l.path + i)}
							<div class="link">
								{#if i > 0}<ArrowDown size={12} class="dn" />{/if}
								<div class="rv-row" class:warn={l.missing}>
									{#if l.missing}
										<TriangleAlert size={13} /><span class="rv-k">{l.path}</span><span class="rv-note"
											>not found</span
										>
									{:else if local(l.path) && l.path !== ctx.path}
										<button class="rv-link rv-k" onclick={() => openFile(ctx.worktreeId, l.path)}
											>{l.path}</button
										>
										<span class="rv-note">{Object.keys(l.options).length} options</span>
									{:else}
										<span class="rv-k">{l.path}</span>
										<span class="rv-note"
											>{l.path === ctx.path ? "this file" : `${Object.keys(l.options).length} options`}</span
										>
									{/if}
								</div>
							</div>
						{/each}
					</div>
				</section>
			{/if}

			<section class="rv-sec">
				<h2>
					Compiler options
					<span class="sp"></span>
					<label class="rv-search">
						<Search size={12} />
						<input placeholder="Filter options" bind:value={q} aria-label="Filter options" />
					</label>
				</h2>
				<div class="rv-list">
					{#each opts as o (o.key)}
						<div class="rv-row opt">
							<div class="kv">
								<span class="rv-k">{o.key}</span>
								<span class="rv-chip mono" class:ok={o.value === true} class:bad={o.value === false}
									>{fmt(o.value)}</span
								>
								{#if o.from !== ctx.path}<span class="rv-note"
										>from {o.from.split("/").slice(-2).join("/")}</span
									>{/if}
							</div>
							{#if TS_DOCS[o.key]}<div class="rv-note">{TS_DOCS[o.key]}</div>{/if}
						</div>
					{:else}
						<div class="rv-empty">No match</div>
					{/each}
				</div>
			</section>

			{#if model.include.length || model.exclude.length || model.files.length || model.references.length}
				<section class="rv-sec">
					<h2>Scope</h2>
					<div class="rv-list">
						{#each [["include", model.include], ["exclude", model.exclude], ["files", model.files], ["references", model.references]] as [label, list] (label)}
							{#if (list as string[]).length}
								<div class="rv-row">
									<span class="rv-k">{label}</span>
									<span class="rv-v wrap">{(list as string[]).join("   ")}</span>
								</div>
							{/if}
						{/each}
					</div>
				</section>
			{/if}
		{/if}
	</div>
</div>

<style>
	.chain {
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	.link :global(.dn) {
		margin: 2px 0 2px 16px;
		color: var(--ca-text-disabled);
		display: block;
	}
	.chain .rv-row {
		border: 0.5px solid var(--rv-line);
		border-radius: 8px;
	}
	.opt {
		flex-direction: column;
		align-items: stretch;
		gap: 2px;
	}
	.kv {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.sp {
		flex: 1;
	}
</style>
