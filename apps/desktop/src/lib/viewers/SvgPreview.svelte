<script lang="ts">
	/**
	 * Live SVG preview of the editor's text. The URL is derived from `text` (never an effect that
	 * writes state it reads: that loops and takes the whole app down), and each URL is revoked by
	 * the cleanup once the next one is shown or the preview unmounts.
	 */
	import ImageViewer from "#lib/viewers/ImageViewer.svelte";
	import { MIME } from "#lib/viewers/kind.ts";

	let { text, path, size, focused }: { text: string; path: string; size: number; focused: boolean } =
		$props();

	let blob = $derived(new Blob([text], { type: MIME.svg }));
	let url = $derived(URL.createObjectURL(blob));

	$effect(() => {
		const u = url;
		return () => URL.revokeObjectURL(u);
	});
</script>

<ImageViewer {url} {blob} {path} {size} {focused} />
