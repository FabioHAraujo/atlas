declare global {
	namespace App {
		interface Error {
			/** Kept by `hooks.client.ts` so error panels can show where an unexpected error came from. */
			stack?: string;
		}
	}
	interface Window {
		/** Set by the shell's initialization script when `ATLAS_BOOT_TRACE` is on (see `lib/boot.ts`). */
		__ATLAS_BOOT__?: boolean;
	}
}
export {};
