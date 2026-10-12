// Content and build-time data of the landing page (pages/index.astro keeps only the markup).
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { SITE } from "./site";

/** `/media/<f>?v=<content hash>`: media is cached for 30 days, so a recut needs a new URL. */
export const mediaUrl = (f: string) =>
	`/media/${f}?v=${createHash("sha1").update(readFileSync(`public/media/${f}`)).digest("hex").slice(0, 10)}`;

export const FAQ = [
	{ q: "How do I install it?", a: "Run `curl -fsSL https://atlas.codeatlas.com.br/install.sh | sh`. It downloads the latest release, verifies its SHA-256 and installs `atlas` into `~/.atlas/bin`. Then `atlas desktop` installs the desktop app, or download the .dmg from the GitHub releases page." },
	{ q: "What does it run on?", a: "Prebuilt releases are macOS 13 or later on Apple silicon only: the CLI and the desktop app with its GPU terminal. The CLI, the TUI and the MCP server also build from source on Linux; there are no prebuilt Linux binaries. No Windows." },
	{ q: "Is it open source?", a: "Yes. The source is on GitHub under MIT or Apache-2.0, at your option. Issues and pull requests are welcome." },
	{ q: "Do I need the desktop app to use atlas.yaml?", a: "No. The CLI, the TUI and the MCP server work on their own. The desktop app is a client of the same runners, so the app, a terminal and an agent all see the same live state." },
	{ q: "Which agents does it work with?", a: "omp, Claude Code and Codex. `atlas setup` detects them, shows what it would change, and with `--apply` adds the MCP server, the skills and the status hooks. Cursor and other MCP clients can be configured by hand." },
	{ q: "Does quitting the app stop my stack?", a: "No. Start runs `atlas dev --detach` and terminals live in a per-user daemon, so stacks and agents keep running when the app quits, crashes or updates." },
	{ q: "Does it send my code or logs anywhere?", a: "No. Atlas is local first. Logs stay in `.logs/` in your project and the control socket is local. The release-notes email form on this page is the only thing on the site that talks to a server; the app only contacts GitHub to check for updates." },
	{ q: "How is it different from process-compose, mprocs or Tilt?", a: "Those run processes. Atlas also gives you the workspace around them: a GPU terminal, a worktree per agent, a project panel with live charts, and an MCP server so agents can read logs and restart services. The README's comparison table is honest about where the others win, such as Windows and replicas." },
];

/** FAQ answers are markdown-ish: `code` spans become <code>. */
export const codeSpans = (s: string) => s.replace(/`([^`]+)`/g, "<code>$1</code>");

export const JSON_LD = {
	"@context": "https://schema.org",
	"@graph": [
		{
			"@type": "SoftwareApplication",
			name: "Atlas",
			applicationCategory: "DeveloperApplication",
			operatingSystem: "macOS 13+ (Apple silicon), Linux (CLI)",
			description: SITE.description,
			url: SITE.url,
			license: ["https://opensource.org/licenses/MIT", "https://opensource.org/licenses/Apache-2.0"],
			publisher: { "@type": "Organization", name: "CodeAtlas", url: SITE.codeatlas },
		},
		{
			"@type": "FAQPage",
			mainEntity: FAQ.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a.replace(/`/g, "") } })),
		},
	],
};

const LOG_ROWS = [
	'22:12:22 worker job email.send done in 37ms',
	'22:12:23 api {"level":30,"msg":"GET /orders","ms":17,"status":200}',
	'22:12:23 web [hmr] updated src/routes/cart.tsx',
	'22:12:24 api {"level":30,"msg":"POST /checkout","ms":221,"status":201}',
	'22:12:24 worker WARN queue lag 1.2s',
	'22:12:25 search query "running shoes" 14ms',
	'22:12:26 database checkpoint complete: wrote 42 buffers',
	'22:12:26 api {"level":30,"msg":"GET /orders","ms":90,"status":200}',
	'22:12:27 web [hmr] updated src/routes/cart.tsx',
	'22:12:28 api {"level":50,"msg":"stripe timeout","ms":5000,"status":504}',
];
/** The scrolling log river wraps around, so the rows appear twice. */
export const LOG_RIVER = [...LOG_ROWS, ...LOG_ROWS].join("\n");
