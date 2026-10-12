declare global {
	namespace App {
		interface Error {
			/** Kept by `hooks.client.ts` so error panels can show where an unexpected error came from. */
			stack?: string;
		}
	}
}
export {};
