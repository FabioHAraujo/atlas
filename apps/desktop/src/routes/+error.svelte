<script lang="ts">
	/**
	 * Replaces SvelteKit's bare "500 Internal Error" page, for the main window and the tray alike.
	 * It never shows the status text: only what happened and what to do.
	 */
	import "@codeatlasdev/ui/styles/global.css";
	import "@codeatlasdev/ui/styles/materials.css";
	import "../app.css";
	import { page } from "$app/state";
	import { onMount } from "svelte";
	import { errors } from "#lib/errors/errors.svelte.ts";
	import ErrorPanel from "#lib/errors/ErrorPanel.svelte";
	import { report, type ErrorReport } from "#lib/errors/report.ts";

	const notFound = $derived(page.status === 404);
	const where = $derived(`route ${page.url.pathname}`);
	let version = $state<string | undefined>();
	let enriched = $state<ErrorReport | undefined>();
	onMount(() => void errors.version().then((v) => (version = v)));

	// Unexpected errors arrive with their real message and stack (`hooks.client.ts`); SvelteKit's own
	// statuses ("Not Found") are not something to show, so say what happened in plain words.
	const base = $derived<ErrorReport>({
		...report(notFound ? { message: `No screen at ${page.url.pathname}` } : (page.error ?? "Unknown error"), {
			where,
		}),
		version,
	});
	// Machine facts and what the app did just before: added when ready, the screen never waits for them.
	$effect(() => {
		const b = base;
		void errors.enrich(b).then((e) => (enriched = e));
	});
	const r = $derived(enriched && enriched.message === base.message ? enriched : base);
</script>

<ErrorPanel
	report={r}
	variant="fullscreen"
	title={notFound ? "This screen doesn't exist" : "Atlas hit an error"}
	hint={notFound
		? "Reload to go back to your workspace."
		: "Your terminals and services keep running in the background. Reload to get back to work. If it comes back, use Ask AI to fix it or file an issue with everything already filled in."}
	retry={() => location.replace("/")}
	retryLabel="Reload app"
/>
