<script lang="ts">
	/** Debug builds: throws while rendering once `window.__atlas.crashTab(id)` armed this id; otherwise renders nothing. */
	import { errors } from "./errors.svelte.ts";

	let { id }: { id: string } = $props();

	function check(armed: boolean) {
		if (armed) throw new Error(`Debug crash: tab ${id} was told to fail while rendering`);
		return "";
	}
</script>

<!-- A template expression re-runs when `crashing[id]` flips, so arming a live tab throws inside the boundary. -->
{check(!!errors.crashing[id])}
