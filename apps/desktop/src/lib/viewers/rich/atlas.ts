/** atlas.yaml / atlas.local.yaml as a display model: services with their `depends_on` graph, actions, tunnel, infra. */
import { asRecord, asString, asArray, isRecord } from "#lib/viewers/rich/data.ts";
import { topoOrder } from "#lib/viewers/rich/compose.ts";

export interface AtlasService {
	name: string;
	port: number | null;
	command: string | null;
	dir: string | null;
	health: string | null;
	critical: boolean;
	enabled: boolean;
	dependsOn: { name: string; condition: string | null }[];
	env: string[];
	hideLogs: boolean;
	openKey: string | null;
}

export interface AtlasAction {
	key: string;
	label: string;
	command: string;
	group: string | null;
	confirm: string | null;
	session: boolean;
	pauses: string[];
}

export interface AtlasDoc {
	name: string | null;
	services: AtlasService[];
	actions: AtlasAction[];
	tunnel: { enabled: boolean; local: number; remote: string; ssh: string } | null;
	preCommand: string | null;
	envFiles: string[];
	infra: string[];
	deployHosts: string[];
	order: string[];
	/** `depends_on` targets that are not services here (the validator also reports them). */
	unknownDeps: { service: string; dep: string }[];
}

const num = (v: unknown) => (typeof v === "number" ? v : null);

export function atlasModel(value: unknown): AtlasDoc {
	const r = asRecord(value);
	const services: AtlasService[] = Object.entries(asRecord(r.services)).map(([name, raw]) => {
		const s = asRecord(raw);
		const dep = s.depends_on;
		return {
			name,
			port: num(s.port),
			command: asString(s.command) ?? null,
			dir: asString(s.dir) ?? null,
			health: asString(s.health) ?? null,
			critical: s.critical === true,
			enabled: s.enabled !== false,
			dependsOn: Array.isArray(dep)
				? dep.map((d) => ({ name: String(d), condition: null }))
				: Object.entries(asRecord(dep)).map(([n, c]) => ({
						name: n,
						condition: typeof c === "string" ? c : null,
					})),
			env: Object.keys(asRecord(s.env)),
			hideLogs: s.hide_logs === true,
			openKey: asString(s.open_key) ?? null,
		};
	});
	const t = isRecord(r.tunnel) ? r.tunnel : null;
	const names = new Set(services.map((s) => s.name));
	const envFiles = r.env_files ?? r.env_file;
	return {
		name: asString(r.name) ?? null,
		services,
		actions: asArray(r.actions).map((a) => {
			const x = asRecord(a);
			return {
				key: String(x.key ?? ""),
				label: asString(x.label) ?? "",
				command: asString(x.command) ?? "",
				group: asString(x.group) ?? null,
				confirm: asString(x.confirm) ?? null,
				session: x.session === true,
				pauses: asArray(x.pause_services).map(String),
			};
		}),
		tunnel: t
			? {
					enabled: t.enabled !== false,
					local: num(t.local_port) ?? 0,
					remote: `${asString(t.remote_host) ?? "?"}:${num(t.remote_port) ?? "?"}`,
					ssh: asString(t.ssh_host) ?? "",
				}
			: null,
		preCommand: asString(r.pre_command) ?? null,
		envFiles: asArray(envFiles).map(String),
		infra: Object.keys(asRecord(asRecord(r.infra).services ?? r.infra)).filter(
			(k) => k !== "compose_file" && k !== "file",
		),
		deployHosts: Object.entries(asRecord(asRecord(r.deploy).targets ?? r.deploy))
			.filter(([, v]) => isRecord(v))
			.map(([k]) => k),
		order: topoOrder(services.map((s) => ({ name: s.name, deps: s.dependsOn.map((d) => d.name) }))),
		unknownDeps: services.flatMap((s) =>
			s.dependsOn.filter((d) => !names.has(d.name)).map((d) => ({ service: s.name, dep: d.name })),
		),
	};
}

/** First source line (1-based) of the YAML key `key` under `services:` (or anywhere), for jumping from a problem. */
export function lineOfKey(text: string, path: string): number | undefined {
	const parts = path.split(/[.[\]]+/).filter(Boolean);
	if (!parts.length) return undefined;
	const lines = text.split("\n");
	let from = 0;
	let found: number | undefined;
	for (const part of parts) {
		const re = new RegExp(`^\\s*-?\\s*${part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*:`);
		const i = lines.findIndex((l, idx) => idx >= from && re.test(l));
		if (i < 0) break;
		found = i + 1;
		from = i + 1;
	}
	return found;
}
