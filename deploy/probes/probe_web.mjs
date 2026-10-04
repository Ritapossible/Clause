// Measures what gl.nondet.web.get does for a 200, a 404 and an unresolvable host.
import fs from "node:fs";
import { clientFor, deployFile, sendTx, readView } from "../lib.mjs";
const network = process.argv[2] || "studio";
const c = clientFor(network, "principal");
const code = fs.readFileSync(new URL("./probe_web.py", import.meta.url));
const { address } = await deployFile(c, code, [], "probe deploy");
console.log("probe at", address);
const URIS = [
  "https://raw.githubusercontent.com/Ritapossible/Clause/main/examples/cities-three.json",
  "https://raw.githubusercontent.com/Ritapossible/Clause/main/examples/no-such-file.json",
  "https://clause-unreachable.invalid/work.json",
];
const out = {};
for (const u of URIS) {
  const t = await sendTx(c, address, "probe", [u], `probe ${u}`);
  out[u] = { consensus: t.consensus, leader: t.leader, result: await readView(c, address, "get", [u]) };
  console.log(u, JSON.stringify(out[u]));
}
fs.writeFileSync(new URL(`./probe-web-${network}.json`, import.meta.url), JSON.stringify({ network, address, recorded_at: new Date().toISOString(), out }, null, 2));
