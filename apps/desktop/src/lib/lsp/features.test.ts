// @ts-nocheck bun test runtime types are not part of the app tsconfig
import { expect, test } from "bun:test";
import { hoverMarkdown } from "./features.ts";
import { renderMarkdown } from "../viewers/markdown.ts";

test("hover contents: MarkupContent, MarkedString and arrays become one markdown string", () => {
	expect(hoverMarkdown({ kind: "markdown", value: "**x**" })).toBe("**x**");
	expect(hoverMarkdown("plain")).toBe("plain");
	expect(hoverMarkdown({ language: "rust", value: "fn a()" })).toBe("```rust\nfn a()\n```");
	expect(hoverMarkdown(["a", { language: "ts", value: "b" }])).toBe("a\n\n---\n\n```ts\nb\n```");
});

test("server documentation is untrusted: raw HTML is escaped, links and images are inert", () => {
	const html = renderMarkdown(
		"<img src=x onerror=alert(1)> [a](javascript:alert(1)) ![i](http://e/x.png) `code`",
		"",
		true,
	);
	expect(html).not.toContain("<img");
	expect(html).not.toContain("<a ");
	expect(html).not.toContain("href");
	expect(html).toContain("&lt;img");
	expect(html).toContain("<code>code</code>");
});
