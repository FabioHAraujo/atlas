// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { describe, expect, test } from "bun:test";
import { lastLines, namesLabel, portsLabel, serviceRows } from "./overview.ts";

const def = (name, extra = {}) => ({ name, enabled: true, port: null, depends_on: [], ...extra });

describe("serviceRows", () => {
	test("stopped stack lists declared services, disabled ones marked, most urgent first", () => {
		const rows = serviceRows([def("b"), def("a", { enabled: false })], undefined, false);
		expect(rows.map((r) => [r.name, r.state])).toEqual([
			["a", "disabled"],
			["b", "stopped"],
		]);
		expect(rows[0].def.name).toBe("a");
	});
	test("running stack uses the live rows and attaches their defs", () => {
		const live = [
			{ name: "api", state: "running" },
			{ name: "web", state: "failed" },
		];
		const rows = serviceRows([def("api")], live, true);
		expect(rows.map((r) => r.name)).toEqual(["web", "api"]);
		expect(rows[0].def).toBeUndefined();
		expect(rows[1].def.name).toBe("api");
	});
	test("a running stack with no live rows yet falls back to the declared ones", () => {
		expect(serviceRows([def("a")], [], true)[0].state).toBe("stopped");
	});
});

describe("labels", () => {
	test("ports: enabled only, first five, remainder counted", () => {
		const defs = [1, 2, 3, 4, 5, 6, 7].map((p) => def(`s${p}`, { port: 3000 + p }));
		defs.push(def("off", { port: 9, enabled: false }), def("none"));
		expect(portsLabel(defs)).toBe(":3001 :3002 :3003 :3004 :3005 +2");
		expect(portsLabel([def("x")])).toBe("");
	});
	test("names: first four then a count", () => {
		expect(namesLabel(["a", "b"])).toBe("a, b");
		expect(namesLabel(["a", "b", "c", "d", "e", "f"])).toBe("a, b, c, d, +2");
	});
});

describe("lastLines", () => {
	test("newest non-marker line per wanted service; stops once all are found", () => {
		const items = [
			{ name: "api", line: "old" },
			{ name: "web", line: "w" },
			{ name: "api", line: "new" },
			{ name: "api", line: "── restart", mark: "restart" },
			{ name: "other", line: "x" },
		];
		expect(lastLines(items, ["api", "web"])).toEqual({ api: "new", web: "w" });
		expect(lastLines(items, ["missing"])).toEqual({});
	});
});
