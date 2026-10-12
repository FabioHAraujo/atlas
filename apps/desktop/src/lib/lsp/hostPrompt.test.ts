// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { hostRestartPrompt } from "./hostPrompt.ts";

test("no terminals: safe, not destructive", () => {
	const p = hostRestartPrompt([]);
	expect(p.destructive).toBe(false);
	expect(p.description).toContain("No terminals are running");
});

test("lists terminals by title and cwd and says they end", () => {
	const p = hostRestartPrompt([
		{ title: "zsh", cwd: "/Users/me/proj/app" },
		{ title: "bun dev", cwd: "/Users/me/proj" },
	]);
	expect(p.destructive).toBe(true);
	expect(p.description).toContain("these 2 terminals");
	expect(p.description).toContain("• zsh — proj/app");
	expect(p.description).toContain("• bun dev — me/proj");
	expect(p.confirmLabel).toBe("End terminals and restart");
});

test("a single terminal is singular", () => {
	const p = hostRestartPrompt([{ title: "", cwd: "/" }]);
	expect(p.description).toContain("this terminal");
	expect(p.description).toContain("• Terminal — /");
	expect(p.confirmLabel).toBe("End terminal and restart");
});

test("long lists are capped", () => {
	const ptys = Array.from({ length: 9 }, (_, i) => ({ title: `t${i}`, cwd: "/a/b" }));
	const p = hostRestartPrompt(ptys);
	expect(p.description).toContain("…and 3 more");
	expect(p.description).not.toContain("t8");
});
