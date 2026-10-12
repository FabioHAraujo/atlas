// @ts-nocheck bun test runtime types are not part of the app tsconfig
import "../../../test/setup.ts";
import { expect, mock, test } from "bun:test";
import { resolve } from "node:path";

const stub = await import("../../../test/ImgStub.svelte");
mock.module(resolve(import.meta.dir, "ImageViewer.svelte"), () => stub);

// Dynamic on purpose: the setup's Svelte loader must be registered before these modules load,
// and static imports are hoisted above it.
const { flushSync, mount, unmount } = await import("svelte");
const { proxy } = await import("svelte/internal/client"); // what `$state({...})` compiles to
const { default: SvgPreview } = await import("./SvgPreview.svelte");

const svg = (fill: string) =>
	`<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect fill="${fill}"/></svg>`;

test("opening and editing an SVG re-renders the preview without an effect loop (the 500 crash)", () => {
	const created: string[] = [];
	const revoked: string[] = [];
	const { createObjectURL, revokeObjectURL } = URL;
	URL.createObjectURL = () => {
		const u = `blob:test/${created.length}`;
		created.push(u);
		return u;
	};
	URL.revokeObjectURL = (u: string) => void revoked.push(u);
	try {
		const props = proxy({ text: svg("red"), path: "a.svg", size: 10, focused: false });
		const target = document.createElement("div");
		const app = flushSync(() => mount(SvgPreview, { target, props }));
		const src = () => target.querySelector("img")?.getAttribute("src");
		expect(src()).toBe("blob:test/0");

		props.text = svg("blue");
		flushSync();
		expect(src()).toBe("blob:test/1");
		expect(revoked).toEqual(["blob:test/0"]);

		unmount(app);
		flushSync();
		expect(revoked).toEqual(["blob:test/0", "blob:test/1"]);
	} finally {
		Object.assign(URL, { createObjectURL, revokeObjectURL });
	}
});
