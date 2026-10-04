// Prints every jury verdict recorded in the given scenario files as a
// markdown table, so the published results come straight from the records.
//
//   node summarize.mjs scenario-studio.json scenario-studio-jury2.json ...
import fs from "node:fs";

const rows = [];
for (const file of process.argv.slice(2)) {
  const r = JSON.parse(fs.readFileSync(file, "utf8"));
  const release = r.jury_release ?? "clause-jury/1";
  for (const [label, c] of Object.entries(r.cases)) {
    if (!c.expected) continue;
    const got = c.verdict ?? "no ruling";
    const conf = c.confidence !== undefined ? ` (${c.confidence})` : "";
    const ok = got === c.expected || (c.expected === "no ruling" && !c.verdict) || c.expected.startsWith("not visible");
    rows.push(`| ${r.network} | ${release} | ${label} | ${c.expected} | ${got}${conf}${c.artifact && c.artifact !== "verified" ? `, work ${c.artifact}` : ""} | ${c.expected.startsWith("not visible") ? "recorded" : ok ? "as expected" : "**missed**"} |`);
  }
}
console.log("| Network | Jury | Case | Expected | Ruling (confidence) | |\n| --- | --- | --- | --- | --- | --- |\n" + rows.join("\n"));
