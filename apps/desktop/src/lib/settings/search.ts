/** Search over the settings catalog and the breadcrumb shown with a result. */
import { SETTINGS_INDEX, type SettingEntry } from "./catalog.ts";
import { SECTIONS, SECTION_TABS } from "./sections.ts";

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/\p{M}/gu, "");

/**
 * Settings matching `query`: every word must appear in the label, description,
 * group or keywords. Label hits rank above description-only hits.
 */
export function searchSettings(query: string, index: SettingEntry[] = SETTINGS_INDEX): SettingEntry[] {
	const words = norm(query).split(/\s+/).filter(Boolean);
	if (!words.length) return [];
	const scored: { e: SettingEntry; score: number; order: number }[] = [];
	index.forEach((e, order) => {
		const label = norm(e.label);
		const rest = norm(`${e.description} ${e.group} ${e.keywords ?? ""}`);
		let score = 0;
		for (const w of words) {
			if (label.startsWith(w) || label.includes(` ${w}`)) score += 3;
			else if (label.includes(w)) score += 2;
			else if (rest.includes(w)) score += 1;
			else return;
		}
		scored.push({ e, score, order });
	});
	return scored.sort((a, b) => b.score - a.score || a.order - b.order).map((x) => x.e);
}

/** Breadcrumb for a result: `Editor › Languages`. The section's first tab is its default page, so it is not repeated. */
export function crumb(e: SettingEntry): string {
	const section = SECTIONS.find((s) => s.id === e.section)!.label;
	const tabs = SECTION_TABS[e.section];
	const tab = e.tab && e.tab !== tabs?.[0]?.id ? tabs?.find((t) => t.id === e.tab)?.label : undefined;
	return tab ? `${section} › ${tab}` : section;
}
