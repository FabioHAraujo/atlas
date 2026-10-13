<script lang="ts">
	/** Body of a terminal tab: ended banner, then the GPU terminal or the xterm.js fallback. */
	import { IconButton } from "@codeatlasdev/ui";
	import { RotateCw } from "@lucide/svelte";
	import GpuTerminal from "#lib/components/GpuTerminal.svelte";
	import Terminal from "#lib/components/Terminal.svelte";
	import { gpu } from "#lib/stores/gpu.svelte.ts";
	import { openPreview } from "#lib/stores/browser.svelte.ts";
	import PaneNotice from "./PaneNotice.svelte";
	import { ws, type Tab } from "#lib/stores/workspace.svelte.ts";

	/** `pty` is set: the caller only renders this for terminals that have one. */
	let { t, pty, active, focused }: { t: Tab; pty: string; active: boolean; focused: boolean } = $props();

	const ended = $derived(ws.ended(t));
	const onLink = (url: string, external: boolean) => openPreview(t.worktreeId, url, external);
</script>

{#if t.chat && !ended}
	<PaneNotice onclick={() => (t.rawView = false)}>Raw omp protocol · back to chat</PaneNotice>
{/if}
{#if ended}
	<PaneNotice>
		<span>{ended === "gone" ? "Terminal is gone" : `Process ended (${ws.exited[pty] ?? "?"})`}</span>
		<IconButton size="sm" variant="text" aria-label="Restart" onclick={() => ws.restart(t.id)}>
			<RotateCw size={13} />
		</IconButton>
		<span class="hint">Restart</span>
	</PaneNotice>
{/if}
{#if ended !== "gone"}
	{#key pty}
		{#if gpu.terminal && !gpu.hostTooOld && !ws.worktree(t.worktreeId)?.hostId}
			<GpuTerminal
				tab={t.id}
				{pty}
				visible={active}
				focused={focused && active}
				readonly={ended !== null}
				{onLink}
			/>
		{:else}
			<Terminal {pty} focused={focused && active} readonly={ended !== null} {onLink} />
		{/if}
	{/key}
{/if}

<style>
	.hint {
		color: var(--ca-text-secondary);
	}
</style>
