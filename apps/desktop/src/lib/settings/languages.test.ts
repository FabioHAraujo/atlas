// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import {
	canUninstall,
	commandProblem,
	hasCustom,
	headline,
	isBusy,
	jsonText,
	parseJsonObject,
	patchLanguage,
	serverView,
	sourceBadge,
	versionOf,
} from "./languages.ts";

const entry = (detected = {}) => ({
	name: "gopls",
	label: "Go",
	languages: ["go"],
	languageLabels: ["Go"],
	install: "go",
	version: "0.16.0",
	detected,
});
const status = (state, extra = {}) => ({ name: "gopls", root: "/p", language: "go", state, ...extra });

describe("serverView", () => {
	test("not installed, with nothing detected", () => {
		expect(serverView(entry(), [])).toEqual({ kind: "missing", text: "Not installed" });
	});

	test("installed on PATH or managed", () => {
		expect(serverView(entry({ source: "path", path: "/usr/bin/gopls" }), []).kind).toBe("path");
		expect(serverView(entry({ source: "managed" }), []).kind).toBe("managed");
	});

	test("a blocked install shows the reason", () => {
		const blocked = { code: "no_go", message: "gopls needs Go." };
		expect(serverView(entry({ blocked }), [])).toEqual({ kind: "blocked", text: "gopls needs Go." });
	});

	test("live status wins: download progress, starting, running", () => {
		const e = entry({ source: "managed" });
		expect(serverView(e, [status("downloading", { progress: "12 MB / 40 MB" })])).toEqual({
			kind: "downloading",
			text: "12 MB / 40 MB",
		});
		expect(serverView(e, [status("downloading")]).text).toBe("Downloading…");
		expect(serverView(e, [status("starting")]).kind).toBe("starting");
		expect(serverView(e, [status("ready")])).toEqual({ kind: "running", text: "Running" });
	});

	test("a crash is shown with its reason, then the message, then a default", () => {
		const e = entry({ source: "managed" });
		const reason = { code: "crashed", message: "Exited with code 2." };
		expect(serverView(e, [status("crashed", { reason, message: "other" })]).text).toBe("Exited with code 2.");
		expect(serverView(e, [status("crashed", { message: "boom" })]).text).toBe("boom");
		expect(serverView(e, [status("crashed")]).text).toBe("The server stopped.");
	});

	test("statuses of other servers are ignored", () => {
		const other = { ...status("ready"), name: "rust-analyzer" };
		expect(serverView(entry(), [other]).kind).toBe("missing");
	});
});

describe("headline", () => {
	test("crashed beats downloading beats starting beats ready", () => {
		const list = [status("ready"), status("starting"), status("downloading"), status("crashed")];
		expect(headline(list).state).toBe("crashed");
		expect(headline(list.slice(0, 3)).state).toBe("downloading");
		expect(headline([])).toBeUndefined();
	});
});

describe("badge, version, actions", () => {
	test("source badge: live source first, then what was detected", () => {
		expect(sourceBadge(entry({ source: "path" }), [])).toBe("PATH");
		expect(sourceBadge(entry({ source: "managed" }), [])).toBe("Managed by Atlas");
		expect(sourceBadge(entry({ source: "path" }), [status("ready", { source: "custom" })])).toBe(
			"Custom command",
		);
		expect(sourceBadge(entry(), [])).toBeNull();
	});

	test("version: running server first, then installed, else null", () => {
		expect(versionOf(entry({ version: "0.15.0" }), [])).toBe("0.15.0");
		expect(versionOf(entry({ version: "0.15.0" }), [status("ready", { version: "0.16.0" })])).toBe("0.16.0");
		expect(versionOf(entry(), [])).toBeNull();
	});

	test("only managed installs can be uninstalled", () => {
		expect(canUninstall(entry({ source: "managed" }))).toBe(true);
		expect(canUninstall(entry({ source: "path" }))).toBe(false);
		expect(canUninstall(entry())).toBe(false);
	});

	test("busy only while downloading", () => {
		expect(isBusy(entry(), [status("downloading")])).toBe(true);
		expect(isBusy(entry(), [status("ready")])).toBe(false);
		expect(isBusy(entry(), [])).toBe(false);
	});
});

describe("parseJsonObject", () => {
	test("empty text clears the field", () => {
		expect(parseJsonObject("")).toEqual({ ok: true, value: undefined });
		expect(parseJsonObject("  \n ")).toEqual({ ok: true, value: undefined });
	});

	test("objects parse", () => {
		expect(parseJsonObject('{ "a": { "b": 1 } }')).toEqual({ ok: true, value: { a: { b: 1 } } });
		expect(parseJsonObject("{}")).toEqual({ ok: true, value: {} });
	});

	test("syntax errors carry the parser message", () => {
		const r = parseJsonObject('{ "a": ');
		expect(r.ok).toBe(false);
		expect(r.error).toStartWith("Not valid JSON: ");
	});

	test("arrays, scalars and null are rejected as non-objects", () => {
		for (const t of ["[]", "3", '"x"', "null", "true"]) {
			const r = parseJsonObject(t);
			expect(r).toEqual({ ok: false, error: 'Must be a JSON object, like { "key": "value" }.' });
		}
	});
});

describe("jsonText", () => {
	test("pretty prints, and empty or missing is an empty box", () => {
		expect(jsonText({ a: 1 })).toBe('{\n  "a": 1\n}');
		expect(jsonText({})).toBe("");
		expect(jsonText(undefined)).toBe("");
	});
});

describe("patchLanguage", () => {
	test("merges into the entry and keeps other languages", () => {
		const lsp = { go: { command: "gopls" }, rust: { disabled: true } };
		expect(patchLanguage(lsp, "go", { args: ["serve"] })).toEqual({
			go: { command: "gopls", args: ["serve"] },
			rust: { disabled: true },
		});
	});

	test("undefined removes a key; an emptied entry leaves the map", () => {
		const lsp = { go: { command: "gopls", args: ["x"] } };
		expect(patchLanguage(lsp, "go", { args: undefined })).toEqual({ go: { command: "gopls" } });
		expect(patchLanguage(lsp, "go", { command: undefined, args: undefined })).toEqual({});
	});

	test("creates a missing entry and never mutates the input", () => {
		const lsp = {};
		expect(patchLanguage(lsp, "zig", { disabled: true })).toEqual({ zig: { disabled: true } });
		expect(lsp).toEqual({});
	});

	test("disabled: false stays set (it is a value, not a missing key)", () => {
		expect(patchLanguage({}, "go", { disabled: false })).toEqual({ go: { disabled: false } });
	});
});

describe("hasCustom", () => {
	test("true for command, args or options; false for disabled only or nothing", () => {
		expect(hasCustom(undefined)).toBe(false);
		expect(hasCustom({ disabled: true })).toBe(false);
		expect(hasCustom({ command: "x" })).toBe(true);
		expect(hasCustom({ args: [] })).toBe(true);
		expect(hasCustom({ settings: {} })).toBe(true);
		expect(hasCustom({ initialization_options: { a: 1 } })).toBe(true);
	});
});

describe("commandProblem", () => {
	test("empty and plain programs are fine", () => {
		expect(commandProblem("")).toBeNull();
		expect(commandProblem("gopls")).toBeNull();
		expect(commandProblem("/opt/my tools/gopls")).toBeNull();
		expect(commandProblem("~/bin/gopls")).toBeNull();
	});

	test("a bare command followed by arguments points to the arguments field", () => {
		expect(commandProblem("gopls serve")).toBe("Put only the program here. Arguments go in the field below.");
	});
});
