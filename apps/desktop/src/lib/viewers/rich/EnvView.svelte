<script lang="ts">
	import { Eye, EyeOff, TriangleAlert, FileDiff, Search } from "@lucide/svelte";
	import { host, b64bytes } from "#lib/host.ts";
	import { diffEnv, ENV_EXAMPLES, looksSecret, parseEnv, type EnvEntry } from "#lib/viewers/rich/env.ts";
	import type { RichCtx } from "#lib/viewers/rich/ctx.ts";
	import Copy from "#lib/viewers/rich/Copy.svelte";
	import "#lib/viewers/rich/rich.css";

	let { ctx }: { ctx: RichCtx } = $props();

	let doc = $derived(parseEnv(ctx.text));
	let revealed = $state<Record<number, boolean>>({});
	let all = $state(false);
	let q = $state("");
	let example = $state<{ name: string; text: string } | null>(null);

	let vars = $derived(doc.entries.filter((e): e is Extract<EnvEntry, { kind: "var" }> => e.kind === "var"));
	let invalid = $derived(
		doc.entries.filter((e): e is Extract<EnvEntry, { kind: "invalid" }> => e.kind === "invalid"),
	);
	let diff = $derived(example ? diffEnv(doc, parseEnv(example.text)) : null);
	let rows = $derived(
		doc.entries.filter((e) => {
			if (!q) return true;
			const s = q.toLowerCase();
			return e.kind === "var"
				? e.key.toLowerCase().includes(s)
				: e.kind === "comment" && e.text.toLowerCase().includes(s);
		}),
	);

	// The sibling `.env.example` (or sample/template/dist) to compare against, unless this file is that file.
	$effect(() => {
		const dir = ctx.path.split("/").slice(0, -1).join("/");
		const self = ctx.path.split("/").pop()!;
		example = null;
		let live = true;
		void (async () => {
			for (const name of ENV_EXAMPLES) {
				if (name === self) continue;
				try {
					const r = await host.fsRead(`${ctx.root}/${dir ? dir + "/" : ""}${name}`, 256 * 1024);
					if (live) example = { name, text: new TextDecoder().decode(b64bytes(r.data)) };
					return;
				} catch {
					// Not there: try the next convention.
				}
			}
		})();
		return () => (live = false);
	});

	const shown = (e: { line: number }) => all || revealed[e.line];
	const mask = (v: string) => "•".repeat(Math.min(Math.max(v.length, 6), 24));
	const dup = (k: string) => doc.duplicates.has(k);
</script>

<div class="rv">
	<div class="rv-inner">
		<header class="rv-head">
			<div class="rv-title">
				<h1>{ctx.path.split("/").pop()}</h1>
				<span class="rv-ver">{vars.length} variable{vars.length === 1 ? "" : "s"}</span>
			</div>
			<div class="rv-facts">
				{#if doc.duplicates.size}<span class="rv-chip warn">{doc.duplicates.size} duplicated</span>{/if}
				{#if invalid.length}<span class="rv-chip bad"
						>{invalid.length} invalid line{invalid.length === 1 ? "" : "s"}</span
					>{/if}
				{#if diff && !diff.missing.length && !diff.extra.length}
					<span class="rv-chip ok">Matches {example?.name}</span>
				{/if}
			</div>
		</header>

		{#if diff && (diff.missing.length || diff.extra.length)}
			<section class="rv-sec">
				<h2><FileDiff size={13} /> Compared with {example?.name}</h2>
				<div class="rv-list">
					{#if diff.missing.length}
						<div class="rv-row warn">
							<span class="rv-chip warn">missing</span>
							<span class="rv-v wrap">{diff.missing.join("  ")}</span>
							<span class="rv-note">in the example, not here</span>
						</div>
					{/if}
					{#if diff.extra.length}
						<div class="rv-row">
							<span class="rv-chip info">extra</span>
							<span class="rv-v wrap">{diff.extra.join("  ")}</span>
							<span class="rv-note">here, not in the example</span>
						</div>
					{/if}
				</div>
			</section>
		{/if}

		<section class="rv-sec">
			<h2>
				Variables
				<span class="sp"></span>
				<label class="rv-search">
					<Search size={12} />
					<input placeholder="Filter" bind:value={q} aria-label="Filter variables" />
				</label>
				<button class="rv-btn" class:on={all} onclick={() => (all = !all)} aria-pressed={all}>
					{#if all}<EyeOff size={12} /> Hide values{:else}<Eye size={12} /> Reveal all{/if}
				</button>
			</h2>
			<div class="rv-list">
				{#each rows as e (e.line)}
					{#if e.kind === "var"}
						<div class="rv-row" class:warn={dup(e.key)}>
							<span class="rv-k">{e.key}</span>
							<span
								class="rv-v"
								class:wrap={shown(e)}
								class:masked={!shown(e)}
								title={shown(e) ? e.value : ""}
							>
								{#if e.value === ""}<i class="empty">empty</i>{:else if shown(e)}{e.value}{:else}{mask(
										e.value,
									)}{/if}
							</span>
							{#if e.comment}<span class="rv-note">{e.comment}</span>{/if}
							{#if dup(e.key)}
								<span
									class="rv-chip warn"
									title="Also defined on line {doc.duplicates
										.get(e.key)
										?.filter((l) => l !== e.line)
										.join(', ')}">duplicate</span
								>
							{/if}
							{#if looksSecret(e.key)}<span class="rv-chip">secret</span>{/if}
							<button
								class="rv-btn icon"
								title="Go to line {e.line}"
								aria-label="Go to line {e.line}"
								onclick={() => ctx.toSource(e.line)}
							>
								<span class="ln">{e.line}</span>
							</button>
							<button
								class="rv-btn icon"
								title={shown(e) ? "Hide value" : "Reveal value"}
								aria-label={shown(e) ? "Hide value" : "Reveal value"}
								onclick={() => (revealed[e.line] = !revealed[e.line])}
							>
								{#if shown(e)}<EyeOff size={12} />{:else}<Eye size={12} />{/if}
							</button>
							<Copy text={e.key} label="Copy key" key />
							<Copy text={e.value} label="Copy value" />
						</div>
					{:else if e.kind === "comment"}
						<div class="rv-row cm"><span class="rv-note">{e.text}</span></div>
					{:else}
						<div class="rv-row bad">
							<TriangleAlert size={13} />
							<span class="rv-v">{e.raw}</span>
							<span class="rv-note">{e.reason}</span>
							<button class="rv-btn" onclick={() => ctx.toSource(e.line)}>Line {e.line}</button>
						</div>
					{/if}
				{:else}
					<div class="rv-empty">{q ? "No variables match" : "No variables yet"}</div>
				{/each}
			</div>
		</section>
	</div>
</div>

<style>
	.masked {
		letter-spacing: 0.08em;
		color: var(--ca-text-disabled);
	}
	.empty {
		font-style: italic;
		color: var(--ca-text-disabled);
		font-family: var(--ui-font, inherit);
	}
	.cm {
		min-height: 24px;
		background: transparent;
	}
	.ln {
		font-family: var(--mono);
		font-size: 10px;
		color: var(--ca-text-disabled);
	}
</style>
