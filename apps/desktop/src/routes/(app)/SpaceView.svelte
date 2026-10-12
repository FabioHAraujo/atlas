<script lang="ts">
	/**
	 * One space's page: header, drawers, banners and the workbench. Mounted for the current space
	 * and its neighbours; everything below reads its worktree/project from `useSpace()`.
	 */
	import { Alert, Button } from "@codeatlasdev/ui";
	import Contain from "#lib/errors/Contain.svelte";
	import ActivityDrawer from "#lib/panel/ActivityDrawer.svelte";
	import ConfirmAction from "./ConfirmAction.svelte";
	import MissingProject from "./MissingProject.svelte";
	import ProjectHeader from "./ProjectHeader.svelte";
	import Workbench from "./Workbench.svelte";
	import { agents } from "#lib/stores/agents.svelte.ts";
	import { useSpace } from "#lib/shell/spaceCtx.ts";

	const space = useSpace();
	let p = $derived(space.project);
</script>

{#if p?.missing}
	<MissingProject {p} />
{:else if p}
	<ProjectHeader {p} />
	{#if space.current}<ActivityDrawer projectId={p.id} />{/if}

	{#if p.error}
		<div class="banner">
			<Alert severity="error" title="atlas.yaml has problems"
				><pre class="mono selectable">{p.error}</pre></Alert
			>
		</div>
	{/if}

	<div class="rule"></div>
	<div class="float-anchor">
		{#if agents.ompIntegration === "missing"}
			<div class="banner floating">
				<Alert severity="info" title="Enable omp integration">
					Atlas shows omp's state (working, needs you, done) through a small omp extension.
					<Button size="sm" onclick={() => agents.enableOmp()}>Enable</Button>
				</Alert>
			</div>
		{/if}
	</div>

	<Contain
		where="Workbench"
		title="The workspace hit an error"
		hint="The sidebar and project header still work."
	>
		<Workbench />
	</Contain>
{/if}

{#if space.current}<ConfirmAction />{/if}

<style>
	.banner {
		padding: 0 20px 10px;
	}
	/* Found by a probe that finishes after the first frame: it floats over the workbench instead
	   of pushing it (and the native terminal views laid over it) down when it arrives. */
	.float-anchor {
		position: relative;
		height: 0;
		z-index: 5;
	}
	.banner.floating {
		position: absolute;
		inset: 0 0 auto 0;
		z-index: 5;
		padding-top: 10px;
		pointer-events: none;
	}
	.banner.floating :global(*) {
		pointer-events: auto;
	}
	.banner pre {
		margin: 4px 0 0;
		font-size: 11.5px;
		white-space: pre-wrap;
	}
	.rule {
		border-bottom: 0.5px solid var(--ca-outline-subtle);
	}
</style>
