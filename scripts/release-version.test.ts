import { describe, expect, test } from "bun:test";
import { diffAllowed, githubFlags, nextVersion, readDefaultChannel, type Channel, type NextInput } from "./release-version.ts";

const NOW = new Date("2026-10-12T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString();

const tags13 = ["v0.6.3", "v1.0.0", "v1.3.0"];

function main(over: Partial<NextInput> & { request: string }) {
  return nextVersion({
    current: "1.3.0",
    tags: tags13,
    branch: "main",
    branches: ["main"],
    now: NOW,
    ...over,
  });
}

function rel(over: Partial<NextInput> & { request: string }) {
  return nextVersion({
    current: "1.4.0-beta.1",
    tags: [...tags13, "v1.4.0-alpha.1", "v1.4.0-beta.1"],
    branch: "release/1.4",
    branches: ["main", "release/1.4"],
    now: NOW,
    lastPrereleaseTagDate: hoursAgo(72),
    ...over,
  });
}

describe("alpha", () => {
  test("first alpha after a stable bumps the minor", () => {
    const r = main({ request: "alpha" });
    expect(r.errors).toEqual([]);
    expect(r.version).toBe("1.4.0-alpha.1");
    expect(r.tag).toBe("v1.4.0-alpha.1");
    expect(r.channel).toBe("alpha");
  });

  test("counter comes from tags, not Cargo.toml", () => {
    const r = main({ request: "alpha", tags: [...tags13, "v1.4.0-alpha.1", "v1.4.0-alpha.2", "v1.4.0-alpha.9", "v1.4.0-alpha.10"] });
    expect(r.version).toBe("1.4.0-alpha.11");
  });

  test("keeps counting inside the current alpha base", () => {
    const r = main({ request: "alpha", current: "1.4.0-alpha.2", tags: [...tags13, "v1.4.0-alpha.1", "v1.4.0-alpha.2"] });
    expect(r.version).toBe("1.4.0-alpha.3");
  });

  test("bumps the minor once release/<base> exists", () => {
    const r = main({
      request: "alpha",
      current: "1.4.0-alpha.3",
      tags: [...tags13, "v1.4.0-alpha.3"],
      branches: ["main", "release/1.4"],
    });
    expect(r.version).toBe("1.5.0-alpha.1");
  });

  test("bumps the minor once the base has a beta, rc or stable tag", () => {
    for (const t of ["v1.4.0-beta.1", "v1.4.0-rc.1", "v1.4.0"]) {
      const r = main({ request: "alpha", current: "1.4.0-alpha.3", tags: [...tags13, "v1.4.0-alpha.3", t] });
      expect(r.version).toBe("1.5.0-alpha.1");
    }
  });

  test("--bump major starts a new major line", () => {
    const r = main({ request: "alpha", bump: "major" });
    expect(r.version).toBe("2.0.0-alpha.1");
  });

  test("only on main", () => {
    const r = rel({ request: "alpha" });
    expect(r.errors.join(" ")).toMatch(/alpha.*main/i);
  });

  test("tag collision is an error", () => {
    // current says alpha.1 but the tag for alpha.2 exists out of band: counter is derived from tags so no collision.
    const r = main({ request: "alpha", current: "1.4.0-alpha.1", tags: [...tags13, "v1.4.0-alpha.2"] });
    expect(r.version).toBe("1.4.0-alpha.3");
  });
});

describe("beta", () => {
  test("first beta on main creates release/X.Y", () => {
    const r = main({ request: "beta", current: "1.4.0-alpha.3", tags: [...tags13, "v1.4.0-alpha.1", "v1.4.0-alpha.3"] });
    expect(r.errors).toEqual([]);
    expect(r.version).toBe("1.4.0-beta.1");
    expect(r.createBranch).toBe("release/1.4");
    expect(r.channel).toBe("beta");
  });

  test("first beta from a stable current uses the same base as alpha would", () => {
    const r = main({ request: "beta" });
    expect(r.version).toBe("1.4.0-beta.1");
    expect(r.createBranch).toBe("release/1.4");
  });

  test("first beta refuses when release/X.Y already exists", () => {
    const r = main({
      request: "beta",
      current: "1.4.0-alpha.3",
      tags: [...tags13, "v1.4.0-alpha.3"],
      branches: ["main", "release/1.4"],
    });
    // main alpha base is 1.5.0 now, so a beta from main would branch release/1.5
    expect(r.version).toBe("1.5.0-beta.1");
    expect(r.createBranch).toBe("release/1.5");
  });

  test("on release/X.Y increments beta.N from tags", () => {
    const r = rel({ request: "beta", tags: [...tags13, "v1.4.0-beta.1", "v1.4.0-beta.2", "v1.4.0-beta.10"] });
    expect(r.version).toBe("1.4.0-beta.11");
    expect(r.createBranch).toBeUndefined();
  });

  test("refused on a non-main, non-release branch", () => {
    const r = main({ request: "beta", branch: "feature/x", branches: ["main", "feature/x"] });
    expect(r.errors.join(" ")).toMatch(/main|release\//);
  });

  test("refused after an rc exists on the branch", () => {
    const r = rel({ request: "beta", tags: [...tags13, "v1.4.0-beta.2", "v1.4.0-rc.1"] });
    expect(r.errors.join(" ")).toMatch(/rc/);
  });
});

describe("rc", () => {
  test("on release/X.Y starts at rc.1", () => {
    const r = rel({ request: "rc" });
    expect(r.version).toBe("1.4.0-rc.1");
    expect(r.channel).toBe("beta");
  });

  test("increments rc.N", () => {
    const r = rel({ request: "rc", tags: [...tags13, "v1.4.0-beta.1", "v1.4.0-rc.1", "v1.4.0-rc.2"] });
    expect(r.version).toBe("1.4.0-rc.3");
  });

  test("needs a beta first", () => {
    const r = rel({ request: "rc", tags: [...tags13, "v1.4.0-alpha.1"] });
    expect(r.errors.join(" ")).toMatch(/beta/);
  });

  test("not on main", () => {
    const r = main({ request: "rc" });
    expect(r.errors.join(" ")).toMatch(/release\//);
  });
});

describe("stable", () => {
  test("on release/X.Y after soak", () => {
    const r = rel({ request: "stable" });
    expect(r.errors).toEqual([]);
    expect(r.version).toBe("1.4.0");
    expect(r.tag).toBe("v1.4.0");
    expect(r.channel).toBe("stable");
    expect(r.notes ?? []).toEqual([]);
  });

  test("refuses on main", () => {
    const r = main({ request: "stable" });
    expect(r.errors.join(" ")).toMatch(/release\/X\.Y|release\//);
  });

  test("refuses without a prerelease tag of the base", () => {
    const r = rel({ request: "stable", tags: tags13 });
    expect(r.errors.join(" ")).toMatch(/prerelease/i);
  });

  test("refuses inside the 48h soak", () => {
    const r = rel({ request: "stable", lastPrereleaseTagDate: hoursAgo(10) });
    expect(r.errors.join(" ")).toMatch(/soak/i);
    expect(r.errors.join(" ")).toMatch(/--force-soak/);
  });

  test("exactly 48h is enough", () => {
    const r = rel({ request: "stable", lastPrereleaseTagDate: hoursAgo(48) });
    expect(r.errors).toEqual([]);
  });

  test("--force-soak overrides and leaves a note for the release notes", () => {
    const r = rel({ request: "stable", lastPrereleaseTagDate: hoursAgo(10), forceSoak: true });
    expect(r.errors).toEqual([]);
    expect(r.version).toBe("1.4.0");
    expect(r.notes?.join(" ")).toMatch(/soak/i);
  });

  test("unknown prerelease date is an error, not a pass", () => {
    const r = rel({ request: "stable", lastPrereleaseTagDate: undefined });
    expect(r.errors.join(" ")).toMatch(/soak|date/i);
  });

  test("refuses when the stable tag already exists", () => {
    const r = rel({ request: "stable", tags: [...tags13, "v1.4.0-beta.1", "v1.4.0"] });
    expect(r.errors.join(" ")).toMatch(/exists/);
  });

  test("an alpha-only base cannot be promoted", () => {
    const r = rel({ request: "stable", tags: [...tags13, "v1.4.0-alpha.3"] });
    expect(r.errors.join(" ")).toMatch(/beta|rc/);
  });
});

describe("patch", () => {
  test("only on release/X.Y", () => {
    const r = main({ request: "patch" });
    const msg = r.errors.join(" ");
    expect(msg).toMatch(/hotfix/i);
    expect(msg).toMatch(/release\//);
  });

  test("X.Y.(Z+1) after the stable exists", () => {
    const r = rel({ request: "patch", current: "1.4.0", tags: [...tags13, "v1.4.0-beta.1", "v1.4.0"] });
    expect(r.errors).toEqual([]);
    expect(r.version).toBe("1.4.1");
    expect(r.channel).toBe("stable");
  });

  test("continues from the highest patch tag", () => {
    const r = rel({ request: "patch", current: "1.4.1", tags: [...tags13, "v1.4.0", "v1.4.1", "v1.4.2"] });
    expect(r.version).toBe("1.4.3");
  });

  test("refused before the .0 stable exists", () => {
    const r = rel({ request: "patch" });
    expect(r.errors.join(" ")).toMatch(/stable/i);
  });
});

describe("minor / major", () => {
  test("are no longer a direct path and explain the new flow", () => {
    for (const request of ["minor", "major"]) {
      const r = main({ request });
      expect(r.errors.join(" ")).toMatch(/alpha|beta/);
      expect(r.version).toBeUndefined();
    }
  });
});

describe("explicit versions", () => {
  test("valid alpha on main", () => {
    const r = main({ request: "1.4.0-alpha.1" });
    expect(r.errors).toEqual([]);
    expect(r.version).toBe("1.4.0-alpha.1");
    expect(r.channel).toBe("alpha");
  });

  test("must be greater than every existing tag", () => {
    const r = main({ request: "1.3.0-alpha.1" });
    expect(r.errors.join(" ")).toMatch(/greater|newer|older/i);
  });

  test("rejects counters glued to the label", () => {
    const r = main({ request: "1.4.0-alpha10" });
    expect(r.errors.join(" ")).toMatch(/alpha10|counter|dot/i);
  });

  test("rejects unknown labels", () => {
    for (const v of ["1.4.0-nightly.1", "1.4.0-dev.1", "1.4.0-foo"]) {
      expect(main({ request: v }).errors.length).toBeGreaterThan(0);
    }
  });

  test("rejects leading zeros, build metadata and a v prefix", () => {
    for (const v of ["1.4.0-alpha.01", "01.4.0", "1.4.0-alpha.1+abc", "v1.4.0-alpha.1", "1.4", "1.4.0-alpha"]) {
      expect(main({ request: v }).errors.length).toBeGreaterThan(0);
    }
  });

  test("tag collision", () => {
    const r = main({ request: "1.3.0" });
    expect(r.errors.join(" ")).toMatch(/exists|greater/i);
  });

  test("follows the branch rules of its channel: alpha on a release branch is refused", () => {
    const r = rel({ request: "1.5.0-alpha.1" });
    expect(r.errors.join(" ")).toMatch(/alpha.*main/i);
  });

  test("explicit stable follows the stable rules (not from main)", () => {
    const r = main({ request: "1.4.0" });
    expect(r.errors.join(" ")).toMatch(/release\//);
  });

  test("explicit beta on main creates release/X.Y", () => {
    const r = main({ request: "1.4.0-beta.1" });
    expect(r.errors).toEqual([]);
    expect(r.createBranch).toBe("release/1.4");
  });

  test("explicit beta on a release branch must match its X.Y", () => {
    const r = rel({ request: "1.5.0-beta.1" });
    expect(r.errors.join(" ")).toMatch(/1\.4/);
  });

  test("explicit stable on release/X.Y still needs soak", () => {
    const r = rel({ request: "1.4.0", lastPrereleaseTagDate: hoursAgo(1) });
    expect(r.errors.join(" ")).toMatch(/soak/i);
  });

  test("explicit stable on release/X.Y after soak", () => {
    const r = rel({ request: "1.4.0" });
    expect(r.errors).toEqual([]);
    expect(r.version).toBe("1.4.0");
  });
});

describe("unknown request", () => {
  test("is an error", () => {
    expect(main({ request: "banana" }).errors.length).toBeGreaterThan(0);
    expect(main({ request: "" }).errors.length).toBeGreaterThan(0);
  });
});

describe("diffAllowed", () => {
  test("version files and the changelog are fine", () => {
    expect(
      diffAllowed(["Cargo.toml", "Cargo.lock", "CHANGELOG.md", "crates/atlas-cli/Cargo.toml", "crates/atlas-core/Cargo.toml"]),
    ).toEqual([]);
  });

  test("returns every offending file", () => {
    expect(diffAllowed(["Cargo.lock", "crates/atlas-cli/src/main.rs", "docs/release.md", "crates/atlas-cli/Cargo.toml"])).toEqual([
      "crates/atlas-cli/src/main.rs",
      "docs/release.md",
    ]);
  });

  test("a Cargo.toml nested deeper than crates/<name> is not a version file", () => {
    expect(diffAllowed(["crates/a/b/Cargo.toml", "apps/desktop/Cargo.toml", "site/CHANGELOG.md"])).toEqual([
      "crates/a/b/Cargo.toml",
      "apps/desktop/Cargo.toml",
      "site/CHANGELOG.md",
    ]);
  });

  test("empty diff is fine", () => {
    expect(diffAllowed([])).toEqual([]);
  });
});

// Incident guard: GitHub's "Latest" showed v1.4.0 while every user (and every new release) was on the default
// channel, alpha. A release of the DEFAULT channel is published as a normal, "Latest" release; any other
// prerelease stays a prerelease. The default is data/channels.json, the same file atlas-core and the site read.
describe("githubFlags", () => {
  test("pre-GA (default alpha): an alpha is NOT a prerelease and IS Latest", () => {
    expect(githubFlags("v1.5.0-alpha.4", "alpha")).toEqual({ prerelease: false, makeLatest: true });
  });
  test("pre-GA: a beta or rc stays a prerelease and never Latest", () => {
    expect(githubFlags("v1.5.0-beta.1", "alpha")).toEqual({ prerelease: true, makeLatest: false });
    expect(githubFlags("v1.5.0-rc.1", "alpha")).toEqual({ prerelease: true, makeLatest: false });
  });
  test("pre-GA: a stable is Latest too (it is the newest of the default channel's accepted builds)", () => {
    expect(githubFlags("v1.5.0", "alpha")).toEqual({ prerelease: false, makeLatest: true });
  });
  test("a beta default: beta and rc are Latest, alpha is a prerelease", () => {
    expect(githubFlags("v1.5.0-beta.1", "beta")).toEqual({ prerelease: false, makeLatest: true });
    expect(githubFlags("v1.5.0-rc.2", "beta")).toEqual({ prerelease: false, makeLatest: true });
    expect(githubFlags("v1.5.0-alpha.4", "beta")).toEqual({ prerelease: true, makeLatest: false });
  });
  test("GA (default stable): the old behaviour, any '-' tag is a prerelease and never Latest", () => {
    expect(githubFlags("v1.5.0-alpha.4", "stable")).toEqual({ prerelease: true, makeLatest: false });
    expect(githubFlags("v1.5.0-beta.1", "stable")).toEqual({ prerelease: true, makeLatest: false });
    expect(githubFlags("v1.5.0", "stable")).toEqual({ prerelease: false, makeLatest: true });
  });
  test("a label Atlas does not ship is always a prerelease", () => {
    for (const d of ["stable", "beta", "alpha"] as const) {
      expect(githubFlags("v1.5.0-nightly.1", d)).toEqual({ prerelease: true, makeLatest: false });
    }
  });
  test("the tag may come without the leading v", () => {
    expect(githubFlags("1.5.0-alpha.4", "alpha")).toEqual({ prerelease: false, makeLatest: true });
  });
});

describe("the default channel copies", () => {
  const root = new URL("../", import.meta.url);
  const text = (p: string) => Bun.file(new URL(p, root)).text();
  test("data/channels.json `default` is what #[default] says on atlas_core::channel::Channel", async () => {
    const json = JSON.parse(await text("crates/atlas-core/data/channels.json"));
    const rust = (await text("crates/atlas-core/src/channel.rs")).match(/#\[default\]\s*(\w+)/)?.[1]?.toLowerCase();
    expect(json.default).toBe(rust);
    expect(readDefaultChannel(json)).toBe(rust as Channel);
  });
  test("readDefaultChannel rejects a missing or unknown default instead of guessing", () => {
    expect(() => readDefaultChannel({})).toThrow();
    expect(() => readDefaultChannel({ default: "nightly" })).toThrow();
  });
  test("release.yml takes prerelease/make_latest from release-version.ts, not from a contains('-') guess", async () => {
    const yml = await text(".github/workflows/release.yml");
    expect(yml).not.toMatch(/prerelease:\s*\$\{\{\s*contains\(/);
    expect(yml).not.toMatch(/make_latest:\s*\$\{\{\s*!contains\(/);
    expect(yml).toContain("scripts/release-version.ts github-flags");
  });
});
