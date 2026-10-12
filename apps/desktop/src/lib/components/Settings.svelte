<script lang="ts">
	/** Settings dialog: section nav on the left, the selected page (or search results) on the right. */
	import { Dialog } from "@codeatlasdev/ui";
	import { tick } from "svelte";
	import HelpSettings from "#lib/onboarding/HelpSettings.svelte";
	import { searchSettings, type SettingEntry } from "#lib/settings/index.ts";
	import PageHead from "#lib/settings/PageHead.svelte";
	import { updates as u } from "#lib/stores/updates.svelte.ts";
	import AgentSettings from "./AgentSettings.svelte";
	import EditorSettings from "./EditorSettings.svelte";
	import SearchResults from "./settings/SearchResults.svelte";
	import SectionTitle from "./settings/SectionTitle.svelte";
	import SettingsNav from "./settings/SettingsNav.svelte";
	import UpdatesSection from "./settings/UpdatesSection.svelte";
	import ShellSettings from "./ShellSettings.svelte";
	import ShortcutSettings from "./ShortcutSettings.svelte";
	import SshSettings from "./SshSettings.svelte";
	import WorkspaceSettings from "./WorkspaceSettings.svelte";

	let results = $derived(searchSettings(u.query));
	let searching = $derived(u.query.trim() !== "");
	let paneEl: HTMLDivElement | undefined = $state();

	/** Jump to the section/tab of a result and flash the matching row once it renders. */
	async function go(e: SettingEntry) {
		u.section = e.section;
		if (e.tab) u.tab = e.tab;
		u.query = "";
		await tick();
		await new Promise((r) => requestAnimationFrame(r));
		const row = paneEl?.querySelector<HTMLElement>(`[data-setting="${e.id}"]`);
		if (!row) return;
		row.scrollIntoView({ block: "center", behavior: "smooth" });
		row.classList.add("flash");
		setTimeout(() => row.classList.remove("flash"), 1500);
	}
</script>

<Dialog bind:open={u.open} size="xl" class="settings-dialog">
	<div class="wrap">
		<SettingsNav {searching} />

		<div class="pane" bind:this={paneEl}>
			{#if searching}
				<SearchResults {results} query={u.query} onpick={go} />
			{:else if u.section === "general"}
				<PageHead
					title="General"
					description="Keep Atlas up to date and make sure your projects start with the same tools as your terminal."
				/>
				<UpdatesSection />
				<SectionTitle title="Shell for your projects" setting="shell">
					Services start with the PATH and variables of this shell, the same as in your terminal. Pick another
					shell if tools like bun or node are not found.
				</SectionTitle>
				<ShellSettings />
			{:else if u.section === "appearance"}
				<EditorSettings />
			{:else if u.section === "workspaces"}
				<WorkspaceSettings />
			{:else if u.section === "agents"}
				<AgentSettings />
			{:else if u.section === "keyboard"}
				<PageHead
					title="Keyboard shortcuts"
					description="Click a shortcut to change it. Every command is listed, whether it has a key or not."
				/>
				<ShortcutSettings />
			{:else if u.section === "ssh"}
				<SshSettings />
			{:else if u.section === "help"}
				<PageHead
					title="Help & onboarding"
					description="Take the tour again, look up a shortcut, or bring the checklist back."
				/>
				<HelpSettings />
			{/if}
		</div>
	</div>
</Dialog>

<style>
	/* Two panes fill the dialog edge to edge. */
	:global(.settings-dialog .ca-dialog__header) {
		display: none;
	}
	:global(.settings-dialog .ca-dialog__body) {
		padding: 0 !important;
	}
	.wrap {
		display: grid;
		grid-template-columns: 210px minmax(0, 1fr);
		height: min(640px, 80vh);
	}
	.pane {
		min-height: 0;
		overflow-y: auto;
		padding: 22px 24px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}
	/* A scrolling column: children keep their content height (alerts and groups were squeezed). */
	.pane > :global(*) {
		flex-shrink: 0;
	}
</style>
