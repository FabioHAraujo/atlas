/** Transient list picker for LSP results (references, code actions): one `<LspPicker>` renders `picker`. */
import type { PaletteItem } from "#lib/components/Palette.svelte";

export const picker = $state<{ open: boolean; title: string; items: PaletteItem[] }>({
	open: false,
	title: "",
	items: [],
});

export function showPicker(title: string, items: PaletteItem[]) {
	picker.title = title;
	picker.items = items;
	picker.open = true;
}
