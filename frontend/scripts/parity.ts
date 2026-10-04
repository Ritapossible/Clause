// The browser's copy of the funding rule must give the engine's answer on
// every vector the engine wrote (python3 tests/make_spec_vectors.py).
import { readFileSync } from "node:fs";
import { acceptanceTestError } from "../src/lib/spec";

const vectors: { test: string; error: string }[] = JSON.parse(
  readFileSync(new URL("../../tests/fixtures/spec_vectors.json", import.meta.url), "utf8"),
);
let bad = 0;
for (const v of vectors) {
  const got = acceptanceTestError(v.test);
  if (got !== v.error) {
    bad++;
    console.log(`MISMATCH ${JSON.stringify(v.test).slice(0, 60)}\n  engine:  ${v.error}\n  browser: ${got}`);
  }
}
console.log(`${vectors.length - bad}/${vectors.length} vectors agree`);
process.exit(bad ? 1 : 0);
