<script lang="ts">
	/** "Found atlas projects": pick which discovered folders to add. Open it with `show(paths)`. */
	import { Button, Checkbox, Dialog } from "@codeatlasdev/ui";
	import { addPaths } from "./projects.ts";

	let open = $state(false);
	let found = $state<string[]>([]);
	let chosen = $state<Record<string, boolean>>({});

	export function show(paths: string[]) {
		found = paths;
		chosen = Object.fromEntries(paths.map((p) => [p, true]));
		open = true;
	}

	async function addChosen() {
		open = false;
		await addPaths(found.filter((p) => chosen[p]));
	}
</script>

<Dialog bind:open title="Found atlas projects" description="Add them to the sidebar." size="lg">
	<div class="found">
		{#each found as p (p)}
			<Checkbox bind:checked={chosen[p]} label={p} />
		{/each}
	</div>
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (open = false)}>Not now</Button>
		<Button onclick={addChosen}>Add selected</Button>
	{/snippet}
</Dialog>

<style>
	.found {
		display: flex;
		flex-direction: column;
		gap: 10px;
		max-height: 50vh;
		overflow-y: auto;
		font-family: var(--mono);
		font-size: 12px;
	}
</style>
