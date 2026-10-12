/** Makefile and Justfile parsers: targets with their recipes and `##` / `#` descriptions. */

export interface Target {
	name: string;
	deps: string[];
	/** Recipe lines, tab/indent stripped. */
	recipe: string[];
	/** `## text` on the target line or the comment lines right above it. */
	doc: string;
	phony: boolean;
	line: number;
	/** Justfile parameters (`name arg1 arg2='x'`). */
	params: string[];
	/** Pattern/special targets that cannot be run by name. */
	runnable: boolean;
}

export interface MakeDoc {
	targets: Target[];
	variables: { name: string; value: string; line: number }[];
	includes: string[];
	defaultTarget: string | null;
}

/** Join `\`-continued lines, keeping the number of the first physical line. */
function logicalLines(text: string): { text: string; line: number }[] {
	const out: { text: string; line: number }[] = [];
	const raw = text.replace(/\r\n?/g, "\n").split("\n");
	for (let i = 0; i < raw.length; i++) {
		let cur = raw[i];
		const line = i + 1;
		while (/\\$/.test(cur) && i + 1 < raw.length)
			cur = cur.slice(0, -1) + " " + raw[++i].replace(/^\t/, "").trimStart();
		out.push({ text: cur, line });
	}
	return out;
}

export function parseMakefile(text: string): MakeDoc {
	const targets: Target[] = [];
	const variables: MakeDoc["variables"] = [];
	const includes: string[] = [];
	const phony = new Set<string>();
	let docBuf: string[] = [];
	let cur: Target[] = [];
	let define = false;
	for (const { text: l, line } of logicalLines(text)) {
		if (define) {
			if (/^\s*endef\b/.test(l)) define = false;
			continue;
		}
		if (/^\s*define\s/.test(l)) {
			define = true;
			continue;
		}
		if (l.startsWith("\t")) {
			const body = l.slice(1);
			for (const t of cur) t.recipe.push(body);
			continue;
		}
		if (!l.trim()) {
			cur = [];
			docBuf = [];
			continue;
		}
		const c = /^\s*##?\s?(.*)$/.exec(l);
		if (c && l.trim().startsWith("#")) {
			if (l.trim().startsWith("##") || docBuf.length) docBuf.push(c[1]);
			else docBuf = [c[1]];
			continue;
		}
		const inc = /^-?(?:include|sinclude)\s+(.+)$/.exec(l);
		if (inc) {
			includes.push(...inc[1].trim().split(/\s+/));
			continue;
		}
		const v = /^(?:export\s+|override\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*([:+?!]|::)?=\s*(.*)$/.exec(l);
		if (v) {
			variables.push({ name: v[1], value: v[3].replace(/\s+#.*$/, ""), line });
			cur = [];
			docBuf = [];
			continue;
		}
		const t = /^([^\s:#=][^:=#]*?)\s*::?(?!=)\s*([^#]*?)\s*(?:##\s*(.*))?(?:#.*)?$/.exec(l);
		if (!t) continue;
		const names = t[1].trim().split(/\s+/);
		const deps = t[2]
			.split(/\s*\|\s*/)
			.join(" ")
			.split(/\s+/)
			.filter(Boolean);
		if (names[0] === ".PHONY") {
			for (const d of deps) phony.add(d);
			cur = [];
			docBuf = [];
			continue;
		}
		cur = names.map((name) => ({
			name,
			deps,
			recipe: [],
			doc: t[3] ?? docBuf.filter((d) => d.trim()).join(" "),
			phony: false,
			line,
			params: [],
			runnable: !/[%*$]/.test(name) && !name.startsWith("."),
		}));
		targets.push(...cur);
		docBuf = [];
	}
	for (const t of targets) t.phony = phony.has(t.name);
	const first = targets.find((t) => t.runnable);
	return { targets, variables, includes, defaultTarget: first?.name ?? null };
}

export function parseJustfile(text: string): MakeDoc {
	const targets: Target[] = [];
	const variables: MakeDoc["variables"] = [];
	const includes: string[] = [];
	let docLines: string[] = [];
	let cur: Target | null = null;
	const lines = text.replace(/\r\n?/g, "\n").split("\n");
	for (let i = 0; i < lines.length; i++) {
		const l = lines[i];
		const line = i + 1;
		if (/^[ \t]/.test(l) && cur) {
			if (l.trim()) cur.recipe.push(l.replace(/^(\t|    |  )/, ""));
			continue;
		}
		if (!l.trim()) {
			cur = null;
			docLines = [];
			continue;
		}
		if (l.startsWith("#")) {
			docLines.push(l.replace(/^#\s?/, ""));
			continue;
		}
		if (l.startsWith("[")) continue;
		const imp = /^(?:import|mod)\s+\??\s*(?:\w+\s+)?['"]?([^'"\s]+)/.exec(l);
		if (imp) {
			includes.push(imp[1]);
			continue;
		}
		if (/^set\s/.test(l)) continue;
		const v = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_-]*)\s*:=\s*(.*)$/.exec(l);
		if (v) {
			variables.push({ name: v[1], value: v[2], line });
			cur = null;
			docLines = [];
			continue;
		}
		const r =
			/^(@?)([A-Za-z_][A-Za-z0-9_-]*)((?:\s+\*?\+?\$?[A-Za-z_][A-Za-z0-9_-]*(?:=(?:'[^']*'|"[^"]*"|\S+))?)*)\s*:(?!=)\s*(.*)$/.exec(
				l,
			);
		if (!r) continue;
		cur = {
			name: r[2],
			deps: r[4].split(/\s+/).filter(Boolean),
			recipe: [],
			doc: docLines.join(" "),
			phony: false,
			line,
			params: r[3].trim().split(/\s+/).filter(Boolean),
			runnable: true,
		};
		targets.push(cur);
		docLines = [];
	}
	return { targets, variables, includes, defaultTarget: targets[0]?.name ?? null };
}
