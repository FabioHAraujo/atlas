<script lang="ts">
	/** Settings ▸ Appearance: how Atlas looks as an app: theme and accent, the interface font, the file panel and panes. */
	import InterfaceTab from "#lib/settings/InterfaceTab.svelte";
	import PageHead from "#lib/settings/PageHead.svelte";
	import ThemeTab from "#lib/settings/ThemeTab.svelte";
</script>

<PageHead
	title="Appearance"
	description="Theme, accent, interface font and layout. Changes apply right away in every Atlas window."
/>
<ThemeTab />
<InterfaceTab />
