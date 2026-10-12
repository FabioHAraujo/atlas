<script lang="ts">
	// Stand-in for ImageViewer in component tests (the real one pulls in the UI library).
	let { url }: { url: string } = $props();
</script>

<img src={url} alt="" />
