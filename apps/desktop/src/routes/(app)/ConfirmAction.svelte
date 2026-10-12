<script lang="ts">
	import { Button, Dialog } from "@codeatlasdev/ui";
	import { pending, runAction } from "#lib/actions.svelte.ts";
</script>

<Dialog
	open={!!pending.value}
	onOpenChange={(o) => !o && (pending.value = null)}
	title={pending.value?.label}
	description={pending.value?.text}
	size="sm"
>
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (pending.value = null)}>Cancel</Button>
		<Button
			variant="destructive"
			onclick={() => {
				const v = pending.value;
				pending.value = null;
				if (v) runAction(v.id, v.target, true);
			}}>Confirm</Button
		>
	{/snippet}
</Dialog>
