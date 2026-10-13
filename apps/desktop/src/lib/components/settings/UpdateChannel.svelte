<script lang="ts">
	/**
	 * Settings ▸ General ▸ Updates ▸ Update channel: Stable / Beta / Alpha cards. Picking one opens an
	 * inline confirmation with what the switch means; only the confirm persists it (shared with the CLI).
	 * A channel that offers an *older* build never installs it by switching: the panel has a separate,
	 * explicit downgrade button.
	 */
	import { Alert, Button, Spinner } from "@codeatlasdev/ui";
	import {
		Check,
		FlaskConical,
		RefreshCw,
		ShieldCheck,
		Sprout,
		TriangleAlert,
		WifiOff,
	} from "@lucide/svelte";
	import type { Component } from "svelte";
	import { updates as u } from "#lib/stores/updates.svelte.ts";
	import { cardState, confirmCopy, type Channel } from "#lib/updates.ts";

	const ICON: Record<Channel, Component<{ size?: number }>> = {
		stable: ShieldCheck,
		beta: Sprout,
		alpha: FlaskConical,
	};

	let cards = $derived(cardState(u.channels, u.info?.app.version, u.channelState?.channel ?? "stable"));
	let locked = $derived(!!u.channelState?.env_override || !!u.running);
	/** The card the reader picked and has not confirmed yet. */
	let pending = $state<Channel | null>(null);
	let saving = $state(false);
	let els = $state<Record<string, HTMLElement | undefined>>({});
	let roving = $state<Channel | null>(null);

	let pendingCard = $derived(cards.find((c) => c.view.channel === pending && !c.following));
	let confirm = $derived(pendingCard ? confirmCopy(pendingCard.view) : null);
	let tabStop = $derived(roving ?? cards.find((c) => c.following)?.view.channel ?? cards[0]?.view.channel);
	let stageNote = $derived(u.channelState?.stage_note ?? "");

	$effect(() => {
		if (!u.channels.length && !u.channelsLoading && !u.channelsError) void u.loadChannels();
	});

	function pick(c: Channel) {
		if (locked) return;
		pending = c === u.channelState?.channel ? null : c;
	}

	async function apply() {
		if (!pending || saving) return;
		saving = true;
		try {
			if (await u.setChannel(pending)) pending = null;
		} finally {
			saving = false;
		}
	}

	async function downgrade() {
		if (!pending || saving) return;
		saving = true;
		try {
			// Switch first (persisted for the CLI too), then install the older build explicitly.
			if (!(await u.setChannel(pending))) return;
			pending = null;
			await u.downgrade();
		} finally {
			saving = false;
		}
	}

	function move(e: KeyboardEvent, from: number) {
		const to =
			e.key === "ArrowDown" || e.key === "ArrowRight"
				? from + 1
				: e.key === "ArrowUp" || e.key === "ArrowLeft"
					? from - 1
					: e.key === "Home"
						? 0
						: e.key === "End"
							? cards.length - 1
							: undefined;
		if (to === undefined) return;
		e.preventDefault();
		const next = cards[(to + cards.length) % cards.length];
		if (!next) return;
		roving = next.view.channel;
		els[next.view.channel]?.focus();
	}

	function onkey(e: KeyboardEvent, c: Channel) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			pick(c);
		} else if (e.key === "Escape" && pending) {
			e.stopPropagation();
			pending = null;
		}
	}
</script>

<section class="chan" aria-labelledby="chan-title" data-setting="update-channel">
	<div class="head">
		<h3 id="chan-title">Update channel</h3>
		{#if u.channelsLoading}<span class="busy"><Spinner size={11} /> Checking…</span>{/if}
	</div>

	{#if stageNote}<p class="stage">{stageNote}</p>{/if}

	{#if u.channelState?.env_override}
		<p class="note" role="status">
			The channel is forced to <b>{u.channelState.channel}</b> by <code>ATLAS_UPDATE_CHANNEL</code> in this environment.
			Unset it to choose here.
		</p>
	{/if}

	{#if u.channelsError}
		<div class="offline" role="status">
			<WifiOff size={13} />
			<span>Could not read what each channel offers right now. The channels below are still selectable.</span>
			<Button variant="ghost" size="sm" disabled={u.channelsLoading} onclick={() => u.loadChannels()}>
				{#snippet leading()}<RefreshCw size={12} />{/snippet}
				Retry
			</Button>
		</div>
	{/if}

	{#if cards.length === 0}
		<div class="skeleton" aria-busy="true" aria-label="Loading update channels">
			<i></i><i></i><i></i>
		</div>
	{:else}
		<div class="cards" role="radiogroup" aria-label="Update channel" aria-disabled={locked}>
			{#each cards as c, i (c.view.channel)}
				{@const Icon = ICON[c.view.channel]}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div role="presentation" onkeydown={(e) => move(e, i)}>
					<!-- svelte-ignore a11y_no_noninteractive_element_to_interactive_role -->
					<div
						bind:this={els[c.view.channel]}
						class="card"
						class:following={c.following}
						class:pending={pending === c.view.channel}
						class:locked
						role="radio"
						aria-checked={c.following}
						aria-disabled={locked}
						aria-describedby="chan-{c.view.channel}-desc"
						tabindex={c.view.channel === tabStop ? 0 : -1}
						onclick={() => pick(c.view.channel)}
						onkeydown={(e) => onkey(e, c.view.channel)}
					>
						<div class="ico tone-{c.tone}"><Icon size={16} /></div>
						<div class="body" id="chan-{c.view.channel}-desc">
							<div class="top">
								<span class="name">{c.view.label}</span>
								<span class="tag tone-{c.tone}">{c.view.risk_label}</span>
								{#if c.following}<span class="tag follow"
										><Check size={10} aria-hidden="true" /> Following</span
									>{/if}
								{#if c.installed}<span class="tag plain">Installed</span>{/if}
							</div>
							<p class="promise">{c.view.promise}</p>
							<dl>
								<div>
									<dt>Cadence</dt>
									<dd>{c.view.cadence}</dd>
								</div>
								<div>
									<dt>For</dt>
									<dd>{c.view.audience}</dd>
								</div>
							</dl>
							{#if c.view.alpha_era_note}<p class="era">{c.view.alpha_era_note}</p>{/if}
							<p
								class="offer"
								class:newer={c.view.action === "update"}
								class:older={c.view.action === "downgrade"}
							>
								{#if u.channelsLoading && !c.view.offered}<Spinner size={10} />{/if}
								{c.offer}
							</p>
						</div>
					</div>
				</div>
			{/each}
		</div>
	{/if}

	{#if pendingCard && confirm}
		<div class="confirm" role="group" aria-label="Switch to {pendingCard.view.label}">
			<p class="ctext">{confirm.text}</p>
			{#if confirm.downgrade}
				<Alert severity="warning" title="{pendingCard.view.label} offers an older build">
					{pendingCard.view.label} has {confirm.downgrade.version}, which is older than what you run.
					Switching alone keeps your build and waits for something newer. {confirm.downgrade.warning}
				</Alert>
			{/if}
			<div class="actions">
				<Button variant="ghost" size="sm" disabled={saving} onclick={() => (pending = null)}>Cancel</Button>
				{#if confirm.downgrade}
					<Button variant="glass" size="sm" disabled={saving || !!u.running} onclick={downgrade}>
						{#snippet leading()}<TriangleAlert size={13} />{/snippet}
						{confirm.downgrade.label}
					</Button>
				{/if}
				<Button size="sm" disabled={saving} onclick={apply}>
					{#snippet leading()}{#if saving}<Spinner size={12} />{/if}{/snippet}
					Follow {pendingCard.view.label}
				</Button>
			</div>
		</div>
	{/if}
</section>

<style>
	.chan {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 650;
	}
	.busy {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: 11.5px;
		color: var(--ca-text-secondary);
	}
	.stage,
	.note {
		margin: 0;
		padding: 9px 12px;
		border-radius: 10px;
		font-size: 12px;
		line-height: 1.45;
		color: var(--ca-text-secondary);
		background: color-mix(in oklab, var(--ca-semantic-warning) 9%, transparent);
		box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--ca-semantic-warning) 30%, transparent);
	}
	.note b,
	.note code {
		color: var(--ca-text-primary);
	}
	.offline {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--ca-text-secondary);
	}
	.offline span {
		flex: 1;
	}
	.cards {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.card {
		display: flex;
		gap: 12px;
		padding: 12px 14px;
		border-radius: 12px;
		background: var(--ca-surface-raised);
		box-shadow: 0 0 0 0.5px var(--ca-outline-subtle);
		cursor: pointer;
		outline: none;
		transition:
			background 120ms ease,
			box-shadow 120ms ease;
	}
	.card:hover:not(.locked) {
		background: var(--ca-action-hover);
	}
	.card.following {
		box-shadow:
			0 0 0 2px var(--atlas-focus-ring, var(--ca-brand-main)),
			0 0 0 0.5px var(--ca-outline-subtle);
	}
	.card.pending:not(.following) {
		box-shadow: 0 0 0 1.5px color-mix(in oklab, var(--ca-brand-main) 60%, transparent);
	}
	.card.locked {
		background: var(--ca-surface-sunken);
		cursor: not-allowed;
	}
	:global([data-kbd]) .card:focus-visible {
		box-shadow:
			0 0 0 2px var(--ca-surface-raised),
			0 0 0 4px var(--atlas-focus-ring, var(--ca-brand-main));
	}
	.ico {
		flex: none;
		width: 32px;
		height: 32px;
		border-radius: 9px;
		display: grid;
		place-items: center;
		color: var(--tone);
		background: color-mix(in oklab, var(--tone) 14%, transparent);
	}
	.tone-success {
		--tone: var(--ca-semantic-success);
	}
	.tone-warn {
		--tone: var(--ca-semantic-warning);
	}
	.tone-error {
		--tone: var(--ca-semantic-error);
	}
	.body {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		gap: 5px;
	}
	.top {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}
	.name {
		font-weight: 650;
		font-size: 13px;
	}
	.tag {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		font-size: 10.5px;
		font-weight: 600;
		padding: 2px 7px;
		border-radius: 999px;
	}
	.tag.tone-success,
	.tag.tone-warn,
	.tag.tone-error {
		color: var(--tone);
		background: color-mix(in oklab, var(--tone) 14%, transparent);
	}
	.tag.follow {
		color: var(--ca-brand-main);
		background: color-mix(in oklab, var(--ca-brand-main) 14%, transparent);
	}
	.tag.plain {
		color: var(--ca-semantic-info);
		background: color-mix(in oklab, var(--ca-semantic-info) 14%, transparent);
	}
	.promise {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.45;
	}
	dl {
		margin: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
		font-size: 11.5px;
		color: var(--ca-text-secondary);
	}
	dl div {
		display: flex;
		gap: 6px;
	}
	dt {
		flex: none;
		width: 52px;
		font-weight: 600;
	}
	dd {
		margin: 0;
	}
	.era {
		margin: 0;
		font-size: 11.5px;
		color: var(--ca-text-secondary);
		font-style: italic;
	}
	.offer {
		margin: 2px 0 0;
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--ca-text-secondary);
	}
	.offer.newer {
		color: var(--ca-brand-main);
	}
	.offer.older {
		color: var(--ca-semantic-warning);
	}
	.confirm {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px 14px;
		border-radius: 12px;
		background: color-mix(in oklab, var(--ca-brand-main) 7%, var(--ca-surface-raised));
		box-shadow: inset 0 0 0 0.5px color-mix(in oklab, var(--ca-brand-main) 35%, transparent);
	}
	.ctext {
		margin: 0;
		font-size: 12.5px;
		line-height: 1.45;
	}
	.actions {
		display: flex;
		justify-content: flex-end;
		flex-wrap: wrap;
		gap: 8px;
	}
	.skeleton {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.skeleton i {
		height: 96px;
		border-radius: 12px;
		background: var(--ca-surface-sunken);
		animation: pulse 1.4s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.5;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.card {
			transition: none;
		}
		.skeleton i {
			animation: none;
		}
	}
</style>
