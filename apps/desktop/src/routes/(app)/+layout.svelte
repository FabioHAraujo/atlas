<script lang="ts">
	import "@codeatlasdev/ui/styles/global.css";
	import "@codeatlasdev/ui/styles/materials.css";
	import "../../app.css";
	import "@xterm/xterm/css/xterm.css";
	import { Toaster } from "@codeatlasdev/ui";
	import { ChevronLeft, ChevronRight } from "@lucide/svelte";
	import { onMount, type Snippet } from "svelte";
	import AskDialog from "#lib/components/AskDialog.svelte";
	import CrashProbe from "#lib/errors/CrashProbe.svelte";
	import Contain from "#lib/errors/Contain.svelte";
	import ErrorToasts from "#lib/errors/ErrorToasts.svelte";
	import CreatePrDialog from "#lib/components/CreatePrDialog.svelte";
	import DevLine from "#lib/components/DevLine.svelte";
	import NewWorktreeDialog from "#lib/components/NewWorktreeDialog.svelte";
	import Palette from "#lib/components/Palette.svelte";
	import Settings from "#lib/components/Settings.svelte";
	import Sidebar from "#lib/components/Sidebar.svelte";
	import UpdatedCard from "#lib/components/UpdatedCard.svelte";
	import WhatsNew from "#lib/components/WhatsNew.svelte";
	import Onboarding from "#lib/onboarding/Onboarding.svelte";
	import EdgePeek from "#lib/shell/EdgePeek.svelte";
	import TabSwitcher from "#lib/shell/TabSwitcher.svelte";
	import {
		commandItems,
		createItems,
		fileItems,
		jumpItems,
		palettes,
		symbolItems,
	} from "#lib/shell/palettes.svelte.ts";
	import { startSession } from "#lib/shell/session.svelte.ts";
	import { shell } from "#lib/shell/shell.svelte.ts";
	import { historySwipe } from "#lib/shell/gestures.ts";
	import { swipe } from "#lib/shell/swipe.ts";
	import { cancelSwitcher } from "#lib/shell/switcher.svelte.ts";
	import { onKeydown, onKeydownCapture, onKeyup } from "#lib/shell/windowKeys.ts";
	import { agents } from "#lib/stores/agents.svelte.ts";
	import { docks } from "#lib/stores/docks.svelte.ts";
	import { store } from "#lib/stores/projects.svelte.ts";
	import { ws } from "#lib/stores/workspace.svelte.ts";

	let { children }: { children: Snippet } = $props();

	onMount(startSession);
</script>

<!-- Focus can leave the window while ⌃ is held (no keyup arrives): blur drops the switcher overlay. -->
<svelte:window
	onkeydown={onKeydown}
	onkeydowncapture={onKeydownCapture}
	onkeyup={onKeyup}
	onfocus={() => store.refresh()}
	onblur={cancelSwitcher}
/>

{#snippet sidebar()}
	<Contain where="Sidebar" title="The sidebar hit an error" hint="The workspace to the right still works.">
		<Sidebar
			onJump={() => (palettes.jump = true)}
			onAgent={(id) => {
				store.selected = id;
				ws.select(id);
				void agents.launch(id);
			}}
		/>
	</Contain>
{/snippet}

<div
	class="app"
	style:--space-accent={shell.active ? shell.accent(shell.active.id) : undefined}
	style:--space-tint={shell.active ? shell.tint(shell.active.id) : undefined}
>
	<div class="sidebar-slot" class:hidden={!docks.sidebar} inert={!docks.sidebar}>
		<div class="sidebar-panel">{@render sidebar()}</div>
	</div>
	<EdgePeek edge="left" size={260} label="Sidebar" active={!docks.sidebar}>{@render sidebar()}</EdgePeek>
	<main class="content" class:full={!docks.sidebar} use:swipe={historySwipe()}>
		<div class="space-edge" aria-hidden="true"></div>
		<div class="nav-chip nav-chip-prev" aria-hidden="true"><ChevronLeft size={18} /></div>
		<div class="nav-chip nav-chip-next" aria-hidden="true"><ChevronRight size={18} /></div>
		<div class="space-view">
			<CrashProbe id="app" />
			{@render children()}
		</div>
	</main>
</div>

<Palette
	bind:open={palettes.jump}
	placeholder="Jump to worktree, terminal or command"
	items={jumpItems}
	dynamic={createItems}
/>
<Palette bind:open={palettes.commands} placeholder="Run a command" items={commandItems} />
<NewWorktreeDialog />
<CreatePrDialog />
<Palette bind:open={palettes.files} placeholder="Go to file" items={fileItems} />
<Palette bind:open={palettes.symbols} placeholder="Go to symbol in file" items={symbolItems} />
<Settings />
<WhatsNew />
<UpdatedCard />
<DevLine />
<Onboarding />
<AskDialog />
<TabSwitcher />
<Toaster />
<ErrorToasts />
