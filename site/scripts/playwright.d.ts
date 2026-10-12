// `playwright` is deliberately not a site dependency (og.ts is run from a folder that has it installed);
// this declares just the surface og.ts uses so `bun run check` can type-check the script.
declare module "playwright" {
  interface Page {
    goto(url: string, opts?: { waitUntil?: "load" }): Promise<unknown>;
    addStyleTag(opts: { content: string }): Promise<unknown>;
    waitForTimeout(ms: number): Promise<void>;
    screenshot(opts: { path: string; type: "png" }): Promise<unknown>;
  }
  interface Browser {
    newPage(opts: { viewport: { width: number; height: number }; reducedMotion: "reduce" }): Promise<Page>;
    close(): Promise<void>;
  }
  export const chromium: { launch(): Promise<Browser> };
}
