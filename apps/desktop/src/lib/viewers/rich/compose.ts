/** docker-compose model: services with image/build, ports, volumes, env and the `depends_on` graph. */
import { asRecord, asString, isRecord, listOrMap } from "#lib/viewers/rich/data.ts";

export interface ComposeService {
	name: string;
	image: string | null;
	build: string | null;
	ports: string[];
	volumes: string[];
	env: string[];
	envFiles: string[];
	dependsOn: { name: string; condition: string | null }[];
	command: string | null;
	profiles: string[];
	healthcheck: boolean;
	restart: string | null;
	networks: string[];
}

export interface ComposeDoc {
	name: string | null;
	services: ComposeService[];
	volumes: string[];
	networks: string[];
	/** `depends_on` names that match no service. */
	unknownDeps: { service: string; dep: string }[];
	/** Services in start order (dependencies first); cycles keep their declaration order. */
	order: string[];
}

const portStr = (p: unknown): string => {
	if (!isRecord(p)) return String(p);
	const pub = p.published ? `${p.published}:` : "";
	return `${pub}${p.target ?? ""}${p.protocol && p.protocol !== "tcp" ? `/${p.protocol}` : ""}`;
};

const volStr = (v: unknown): string => {
	if (!isRecord(v)) return String(v);
	return `${v.source ?? ""}${v.source ? ":" : ""}${v.target ?? ""}${v.read_only ? ":ro" : ""}`;
};

export function composeModel(value: unknown): ComposeDoc {
	const root = asRecord(value);
	const services: ComposeService[] = Object.entries(asRecord(root.services)).map(([name, raw]) => {
		const s = asRecord(raw);
		const build = s.build;
		const dep = s.depends_on;
		return {
			name,
			image: asString(s.image) ?? null,
			build: typeof build === "string" ? build : isRecord(build) ? (asString(build.context) ?? ".") : null,
			ports: (Array.isArray(s.ports) ? s.ports : []).map(portStr),
			volumes: (Array.isArray(s.volumes) ? s.volumes : []).map(volStr),
			env: listOrMap(s.environment),
			envFiles: listOrMap(s.env_file).map((e) =>
				e.startsWith("{") ? ((JSON.parse(e) as { path?: string }).path ?? e) : e,
			),
			dependsOn: Array.isArray(dep)
				? dep.map((d) => ({ name: String(d), condition: null }))
				: Object.entries(asRecord(dep)).map(([n, c]) => ({
						name: n,
						condition: asString(asRecord(c).condition) ?? null,
					})),
			command: Array.isArray(s.command) ? s.command.join(" ") : (asString(s.command) ?? null),
			profiles: listOrMap(s.profiles),
			healthcheck: isRecord(s.healthcheck),
			restart: asString(s.restart) ?? null,
			networks: Array.isArray(s.networks) ? s.networks.map(String) : Object.keys(asRecord(s.networks)),
		};
	});
	const names = new Set(services.map((s) => s.name));
	const unknownDeps = services.flatMap((s) =>
		s.dependsOn.filter((d) => !names.has(d.name)).map((d) => ({ service: s.name, dep: d.name })),
	);
	return {
		name: asString(root.name) ?? null,
		services,
		volumes: Object.keys(asRecord(root.volumes)),
		networks: Object.keys(asRecord(root.networks)),
		unknownDeps,
		order: topoOrder(services.map((s) => ({ name: s.name, deps: s.dependsOn.map((d) => d.name) }))),
	};
}

/** Dependencies first; a cycle keeps declaration order for the nodes inside it. */
export function topoOrder(nodes: { name: string; deps: string[] }[]): string[] {
	const byName = new Map(nodes.map((n) => [n.name, n]));
	const done = new Set<string>();
	const visiting = new Set<string>();
	const out: string[] = [];
	const visit = (n: string) => {
		if (done.has(n) || visiting.has(n) || !byName.has(n)) return;
		visiting.add(n);
		for (const d of byName.get(n)!.deps) visit(d);
		visiting.delete(n);
		done.add(n);
		out.push(n);
	};
	for (const n of nodes) visit(n.name);
	return out;
}
