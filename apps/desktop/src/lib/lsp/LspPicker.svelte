<script lang="ts">
	import Palette from "#lib/components/Palette.svelte";
	import { picker } from "#lib/lsp/picker.svelte.ts";
</script>

<Palette bind:open={picker.open} placeholder={picker.title} items={() => picker.items} />
