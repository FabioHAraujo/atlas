/** Native GPU terminal for local terminals; on unless the user turned it off (per machine). */
const KEY = "atlas.gpuTerminal";

export const gpu = $state({
	terminal: localStorage.getItem(KEY) !== "0",
	/** The running terminal host predates the raw byte stream and cannot be replaced without
	 * ending terminals (it outlives app updates): terminals use xterm.js until it restarts.
	 * Kept in step with the host state by `stores/hostStatus.svelte.ts`. */
	hostTooOld: false,
});

export function setGpuTerminal(on: boolean) {
	gpu.terminal = on;
	localStorage.setItem(KEY, on ? "1" : "0");
}
