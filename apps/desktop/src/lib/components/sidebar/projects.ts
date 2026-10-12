/** Adding projects to the sidebar: pick a folder, or discover atlas projects on this machine. */

import { toast } from "@codeatlasdev/ui";
import { open as pickFolder } from "@tauri-apps/plugin-dialog";
import { api } from "#lib/api.ts";
import { store } from "#lib/stores/projects.svelte.ts";

export async function addProject() {
	const dir = await pickFolder({ directory: true, title: "Add atlas project" });
	if (typeof dir !== "string") return;
	const p = await store.run("add", () => api.add(dir));
	if (p) {
		await store.refresh();
		store.selected = p.id;
	}
}

/** Paths of projects found on disk, or `[]` after telling the user there are none. */
export async function discover(): Promise<string[]> {
	const paths = await store.run("discover", () => api.discover());
	if (paths && !paths.length) toast.info("No new atlas projects found");
	return paths ?? [];
}

/** Register the chosen paths, then fall back to the first project when nothing is selected. */
export async function addPaths(paths: string[]) {
	for (const p of paths) await store.run("add", () => api.add(p));
	await store.refresh();
	if (!store.selected) store.selected = store.sorted[0]?.id ?? null;
}
