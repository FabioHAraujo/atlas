// bun scripts/gesture-fixtures.ts  — regenerate the synthesized trace fixtures (byte-stable, fixed seeds).
import { suite } from "../apps/desktop/src/lib/shell/traceSuite.ts";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(
	import.meta.dir,
	"../apps/desktop/src/lib/shell/__fixtures__/traces",
);
for (const t of suite())
	writeFileSync(join(dir, `${t.name}.json`), `${JSON.stringify(t)}\n`);
console.log(`${suite().length} traces → ${dir}`);
