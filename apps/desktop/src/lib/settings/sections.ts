/**
 * Settings navigation model: which sections exist, the tabs inside Appearance and how
 * legacy ids resolve to them. Pure: no Svelte, no IPC.
 */

export type SettingsSection =
	"general" | "appearance" | "workspaces" | "agents" | "keyboard" | "ssh" | "help";

export type AppearanceTab = "appearance" | "editor" | "interface" | "terminal";

/** Where Settings opens: a section, plus a tab when the section has tabs. */
export interface SettingsTarget {
	section: SettingsSection;
	tab?: AppearanceTab;
}

export const SECTIONS: { id: SettingsSection; label: string }[] = [
	{ id: "general", label: "General" },
	{ id: "appearance", label: "Appearance" },
	{ id: "workspaces", label: "Workspaces" },
	{ id: "agents", label: "Agents" },
	{ id: "keyboard", label: "Keyboard shortcuts" },
	{ id: "ssh", label: "SSH hosts" },
	{ id: "help", label: "Help & onboarding" },
];

export const APPEARANCE_TABS: { id: AppearanceTab; label: string }[] = [
	{ id: "appearance", label: "Appearance" },
	{ id: "editor", label: "Editor" },
	{ id: "interface", label: "Interface" },
	{ id: "terminal", label: "Terminal" },
];

/**
 * Section ids used before the reorganisation (and by `updates.show(...)` call sites)
 * mapped to where that content lives now.
 */
const LEGACY: Record<string, SettingsTarget> = {
	updates: { section: "general" },
	shell: { section: "general" },
	appearance: { section: "appearance", tab: "appearance" },
	editor: { section: "appearance", tab: "editor" },
};

const SECTION_IDS: Record<SettingsSection, true> = {
	general: true,
	appearance: true,
	workspaces: true,
	agents: true,
	keyboard: true,
	ssh: true,
	help: true,
};
const TAB_IDS: Record<AppearanceTab, true> = {
	appearance: true,
	editor: true,
	interface: true,
	terminal: true,
};
const has = <T extends string>(table: Record<T, true>, k: string): k is T => Object.hasOwn(table, k);

/**
 * Accepts any current or legacy section id, or a `section/tab` pair (`appearance/terminal`),
 * and returns the target. Unknown ids fall back to General.
 */
export function resolveSection(id: string): SettingsTarget {
	const [head, sub] = id.split("/");
	const tab = sub && has(TAB_IDS, sub) ? sub : undefined;
	if (head === "appearance") return { section: "appearance", tab: tab ?? "appearance" };
	if (Object.hasOwn(LEGACY, head)) return LEGACY[head]!;
	if (has(SECTION_IDS, head)) return { section: head };
	return { section: "general" };
}
