/**
 * Machine and app facts for an error report. Everything here is best effort: the screen that calls
 * it is showing because something is already broken, so a failing or hung backend call is skipped,
 * never thrown, and never waited on for long.
 */
import { parseDiagnostics } from "./diagnostics.ts";
import type { Breadcrumb, ErrorContext } from "./report.ts";

export interface ContextSources {
	invoke: (cmd: string) => Promise<unknown>;
	nav: { userAgent: string; language: string };
	route: string;
	crumbs: Breadcrumb[];
	timeoutMs?: number;
}

export function osLabel(ua: string): string | undefined {
	if (/Macintosh|Mac OS X/i.test(ua)) return "macOS";
	if (/Windows/i.test(ua)) return "Windows";
	if (/Linux|X11/i.test(ua)) return "Linux";
	return undefined;
}

const within = <T>(p: Promise<T>, ms: number) =>
	Promise.race([p, new Promise<undefined>((r) => setTimeout(() => r(undefined), ms))]).catch(() => undefined);

export async function gatherContext(s: ContextSources): Promise<ErrorContext> {
	const ms = s.timeoutMs ?? 800;
	const host = (await within(s.invoke("host_status"), ms)) as
		{ version?: string; caps?: string[] } | null | undefined;
	const diag = await within(s.invoke("host_diagnostics"), ms);
	return {
		diagnostics: diag ? parseDiagnostics(diag) : undefined,
		os: osLabel(s.nav.userAgent),
		locale: s.nav.language || undefined,
		route: s.route,
		hostVersion: typeof host?.version === "string" ? host.version : undefined,
		hostCaps: Array.isArray(host?.caps) ? host.caps.filter((c) => typeof c === "string") : undefined,
		breadcrumbs: s.crumbs,
	};
}
