import { invoke } from "@tauri-apps/api/core";

/** Startup timeline mark (`ATLAS_BOOT_TRACE`, see crates/atlas-desktop/src/boot.rs); no-op unless Rust set the flag. */
export function bootMark(name: string) {
	if (window.__ATLAS_BOOT__) void invoke("boot_mark", { name }).catch(() => {});
}
