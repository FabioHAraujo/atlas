<script lang="ts">
	import { Cpu, Layers, MemoryStick, RotateCw, TriangleAlert } from "@lucide/svelte";
	import { fmtMem } from "#lib/format.ts";
	import Kpi from "./Kpi.svelte";

	/** The five headline tiles: service health, restarts, errors, memory and CPU. */
	let {
		running,
		up,
		total,
		failed,
		restarts,
		errors,
		mem,
		cpu,
	}: {
		running: boolean;
		up: number;
		total: number;
		failed: number;
		restarts: number;
		errors: number;
		mem: number;
		cpu: number;
	} = $props();
</script>

<div class="kpis" data-tour="panel-kpis">
	<Kpi
		icon={Layers}
		label="Services"
		value="{up}/{total}"
		hint={running ? "running" : "stopped"}
		tone={failed ? "fail" : running && up === total ? "ok" : "off"}
	/>
	<Kpi
		icon={RotateCw}
		label="Restarts"
		value={String(restarts)}
		hint="last hour"
		tone={restarts ? "warn" : "off"}
	/>
	<Kpi
		icon={TriangleAlert}
		label="Errors"
		value={String(errors)}
		hint="last 5 min"
		tone={errors ? "fail" : "off"}
	/>
	<Kpi
		icon={MemoryStick}
		label="Memory"
		value={running ? fmtMem(Math.round(mem)) : "—"}
		hint="all services"
		tone="off"
	/>
	<Kpi icon={Cpu} label="CPU" value={running ? `${Math.round(cpu)}%` : "—"} hint="of one core" tone="off" />
</div>

<style>
	.kpis {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
		gap: 10px;
	}
</style>
