<script lang="ts">
	import { Alert, Button } from "@codeatlasdev/ui";
	import Contain from "#lib/errors/Contain.svelte";
	import AgentsView from "#lib/components/AgentsView.svelte";
	import ActivityDrawer from "#lib/panel/ActivityDrawer.svelte";
	import { agents } from "#lib/stores/agents.svelte.ts";
	import { store } from "#lib/stores/projects.svelte.ts";
	import { ws } from "#lib/stores/workspace.svelte.ts";
	import ConfirmAction from "./ConfirmAction.svelte";
	import NoProject from "./NoProject.svelte";
	import ProjectHeader from "./ProjectHeader.svelte";
	import Workbench from "./Workbench.svelte";

	let p = $derived(store.current);
</script>

{#if ws.view !== "worktree"}
	<Contain where="Agents view" title="This view hit an error" hint="The rest of Atlas is unaffected.">
		<AgentsView mode={ws.view} />
	</Contain>
{:else if !p}
	<NoProject />
{:else}
	<ProjectHeader {p} />
	<ActivityDrawer projectId={p.id} />

	{#if agents.ompIntegration === "missing"}
		<div class="banner">
			<Alert severity="info" title="Enable omp integration">
				Atlas shows omp's state (working, needs you, done) through a small omp extension.
				<Button size="sm" onclick={() => agents.enableOmp()}>Enable</Button>
			</Alert>
		</div>
	{/if}
	{#if p.error}
		<div class="banner">
			<Alert severity="error" title="atlas.yaml has problems"
				><pre class="mono selectable">{p.error}</pre></Alert
			>
		</div>
	{/if}

	<div class="rule"></div>

	<Contain
		where="Workbench"
		title="The workspace hit an error"
		hint="The sidebar and project header still work."
	>
		<Workbench />
	</Contain>
{/if}

<ConfirmAction />

<style>
	.banner {
		padding: 0 20px 10px;
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
