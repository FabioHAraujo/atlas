<script lang="ts">
	/** Confirmation for deleting one or several worktrees (driven by `sidebar.deleteIds`). */
	import { Button, Checkbox, Dialog } from "@codeatlasdev/ui";
	import { sidebar } from "./state.svelte.ts";
</script>

<Dialog
	open={sidebar.deleteIds.length > 0}
	onOpenChange={(o) => !o && (sidebar.deleteIds = [])}
	title={sidebar.deleteIds.length > 1 ? `Delete ${sidebar.deleteIds.length} worktrees?` : "Delete worktree?"}
	description="Removes the checkout and its terminals. Unmerged branches are kept unless forced."
	size="sm"
>
	<Checkbox bind:checked={sidebar.deleteForce} label="Force (discard changes, delete unmerged branch)" />
	{#snippet actions()}
		<Button variant="ghost" onclick={() => (sidebar.deleteIds = [])}>Cancel</Button>
		<Button variant="destructive" onclick={() => sidebar.confirmDelete()}>Delete</Button>
	{/snippet}
</Dialog>
