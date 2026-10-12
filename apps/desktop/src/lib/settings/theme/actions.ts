/** Export, remove and reveal actions for themes, shared by the Appearance tab. */
import { toast } from "@codeatlasdev/ui";
import { homeDir } from "@tauri-apps/api/path";
import { save } from "@tauri-apps/plugin-dialog";
import { errText } from "#lib/api.ts";
import { host } from "#lib/host.ts";
import { confirmDialog } from "#lib/stores/ask.svelte.ts";
import { themes } from "#lib/stores/theme.svelte.ts";

export type ExportFormat = "json" | "ghostty";

const EXT: Record<ExportFormat, string> = { json: "json", ghostty: "ghostty" };
const slug = (name: string) =>
	name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-|-$/g, "") || "theme";

/** Run `fn`; failures become an error toast instead of an unhandled rejection. */
async function guard(fn: () => Promise<void>) {
	try {
		await fn();
	} catch (e) {
		toast.error(errText(e));
	}
}

export const copyTheme = (name: string, format: ExportFormat) =>
	guard(async () => {
		await navigator.clipboard.writeText(themes.exportTheme(name, format));
		toast.success(format === "json" ? `Copied ${name} as JSON` : `Copied ${name} as a Ghostty config`);
	});

export const saveTheme = (name: string, format: ExportFormat) =>
	guard(async () => {
		const text = themes.exportTheme(name, format);
		const path = await save({
			title: `Save ${name}`,
			defaultPath: `${await homeDir()}/Downloads/${slug(name)}.${EXT[format]}`,
			filters: [{ name: format === "json" ? "Atlas theme" : "Ghostty config", extensions: [EXT[format]] }],
		});
		if (!path) return;
		await host.fsWrite(path, text);
		toast.success(`Saved ${path.split("/").pop()}`);
	});

export const removeTheme = (name: string) =>
	guard(async () => {
		const ok = await confirmDialog(`Remove ${name}?`, {
			description: "Deletes its file from your themes folder.",
			confirmLabel: "Remove",
			destructive: true,
		});
		if (ok) await themes.remove(name);
	});

/** Open `~/.atlas/themes` in Finder (created on first use). */
export const revealThemesFolder = () =>
	guard(async () => {
		const dir = `${await homeDir()}/.atlas/themes`;
		await host.fsMkdir(dir).catch(() => {});
		await host.exec(dir, ["open", dir]);
	});
