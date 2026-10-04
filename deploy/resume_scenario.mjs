// Finish a scenario run whose process died, from the chain alone.
//
// The Bradbury jury-2 run (scenario.mjs) funded, delivered, disputed and
// convened the jury for every case, then its process died during the
// 40-minute appeal wait, before it wrote its record. Everything it did is on
// chain: the deals on the escrow, the rulings on the jury contract. This
// script reads them back, finishes phases 3-5 (apply each ruling, settle the
// lapse case, withdraw, check the books) and writes the record. The
// transaction hashes of the lost phases are not recoverable from this
// script; every verdict in the record is read from `ruling_of` on the jury
// contract, so anyone can check it with one view call.
//
//   node resume_scenario.mjs bradbury
import fs from "node:fs";
import { clientFor, accountFor, sendTx, readView, readUntil } from "./lib.mjs";

const network = process.argv[2] || "bradbury";
const dep = JSON.parse(fs.readFileSync("deployments.json", "utf8"))[network];
const { clause, jury } = dep;
const APPEAL = Number(dep.appeal_seconds);
const buyer = clientFor(network, "agent");
const seller = clientFor(network, "vendor");
const sellerAddr = accountFor("vendor").address;
const GEN = (n) => BigInt(Math.round(n * 1000)) * 10n ** 15n;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fmt = (v) => `${Number(v) / 1e18} GEN`;
const rpc = buyer.chain.rpcUrls.default.http[0];
const log = [];
const cases = {};
let failures = 0;

function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${actual}${ok ? "" : `  (expected ${expected})`}`);
  log.push({ check: label, actual: String(actual), expected: String(expected), ok });
}
async function tx(client, address, fn, args, label) {
  const o = await sendTx(client, address, fn, args, label);
  log.push({ tx: label, hash: o.hash, consensus: o.consensus, leader: o.leader });
  console.log(`  - ${label}: ${o.applied ? "applied" : o.refused ? "refused" : o.consensus}`);
  return o;
}
const deal = (id) => readView(buyer, clause, "get_deal", [id]);
const owedTo = async (who) => BigInt(await readView(buyer, clause, "owed_to", [who]));
async function balance(addr) {
  const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [addr, "latest"] }) });
  return BigInt((await res.json()).result ?? "0x0");
}

// What each deal was, recognised from its own record (the delivered file and
// the clause), and what scenario.mjs expected of it.
function identify(d) {
  const uri = d.delivery?.uri ?? "";
  const line = d.lines[0];
  if (uri.includes("cities-three.json") && (d.refused ?? []).length) return ["case 1b", "met"];
  if (uri.includes("cities-two.json")) return ["case 2", "unmet"];
  if (uri.includes("no-such-file.json")) return ["case 6", "unmet"];
  if (uri.includes(".invalid/")) return ["case 7", "no ruling"];
  if (uri.includes("invoice-wrong.json")) return ["case 8 wrong total, run 1", "unmet"];
  if (uri.includes("invoice-right.json")) return ["case 8 right total, run 1", "met"];
  if (uri.includes("catalog-long.json")) return [line.dispute?.locate ? "case 9 with a location" : "case 9 without a location", line.dispute?.locate ? "unmet" : "not visible to the jury"];
  return [`deal ${d.id}`, "?"];
}

console.log(`escrow ${clause}, jury ${jury} on ${network}; resuming from the chain`);
const status0 = await readView(buyer, clause, "status");
const deals = [];
for (let i = 0; i < Number(status0.deals); i++) deals.push(await deal(i));

console.log("\nWhat is on chain");
const plan = [];
for (const d of deals) {
  const [label, expected] = identify(d);
  const line = d.lines[0];
  const ruling = await readView(buyer, jury, "ruling_of", [clause, d.id, line.id]);
  cases[label] = {
    deal: d.id, clause: line.id, expected, delivery: d.delivery?.uri, locate: line.dispute?.locate ?? "",
    state_before: line.state, ruling_source: `ruling_of(${clause}, ${d.id}, "${line.id}") on ${jury}`,
    ...(ruling.verdict ? ruling : { verdict: undefined }),
  };
  if (label === "case 1b") {
    cases["case 1a (citing capitals)"] = { deal: d.id, refused: d.refused[0] };
    check("case 1a: the dispute citing a clause not in the spec is recorded as refused", d.refused[0].cited, "capitals");
  }
  console.log(`  deal ${d.id} ${label}: ${line.state}; ruling ${ruling.verdict ?? "none"}${ruling.confidence !== undefined ? ` (${ruling.confidence})` : ""}${ruling.artifact ? `, work ${ruling.artifact}` : ""}   [expected ${expected}]`);
  if (ruling.verdict && line.state === "disputed") plan.push({ label, id: d.id, cid: line.id, ruling, amount: BigInt(line.amount) });
}
const c6 = cases["case 6"];
check("case 6: a 404 is the seller's - unmet, no model", `${c6.verdict}/${c6.artifact}`, "unmet/missing");
check("case 7: an unreachable host left no ruling", cases["case 7"].verdict === undefined, true);

console.log("\nThe escrow applies each ruling (its appeal window long passed)");
for (const p of plan) {
  const s0 = await owedTo(sellerAddr);
  const a = await tx(buyer, clause, "apply_ruling", [p.id, p.cid], `${p.label}: apply`);
  check(`${p.label}: the escrow applies the ruling`, a.applied, true);
  const line = (await readUntil(() => deal(p.id), (d) => d.lines[0].state !== "disputed", { seconds: 600, every: 10 })).value.lines[0];
  const due = line.verdict === "met" ? p.amount + GEN(0.01) : line.verdict === "undetermined" ? p.amount : 0n;
  check(`${p.label}: ${line.verdict} -> ${line.state}, seller credited`, (await owedTo(sellerAddr)) - s0, due);
  cases[p.label].state = line.state;
  cases[p.label].apply_tx = a.hash;
}

console.log("\nThe lapse case");
const c7 = deals.find((d) => identify(d)[0] === "case 7");
const s7 = await tx(seller, clause, "settle", [c7.id], "case 7: settle");
const l7 = (await readUntil(() => deal(c7.id), (d) => d.lines[0].state !== "disputed", { seconds: 600, every: 10 })).value.lines[0];
check("case 7: with no ruling, the clause pays the seller at its deadline", `${l7.state}/${l7.lapsed}`, "released/true");
cases["case 7"].state = l7.state;
cases["case 7"].settle_tx = s7.hash;

console.log("\nThe seller withdraws; its wallet balance is read until the GEN arrives");
const owed = await owedTo(sellerAddr);
const before = await balance(sellerAddr);
const w = await tx(seller, clause, "withdraw", [], "withdraw");
check("withdraw applied", w.applied, true);
const arrived = (await readUntil(() => balance(sellerAddr), (b) => b > before, { seconds: 2700, every: 15 })).value;
const received = arrived - before;
const fee = owed - received;
console.log(`    wallet +${fmt(received)} (owed ${fmt(owed)}, withdraw fee ${fmt(fee)})`);
check("the seller's wallet received what it was owed, less its own transaction fee", fee >= 0n && fee < GEN(0.001), true);
cases.withdraw = { owed: String(owed), received: String(received), fee: String(fee), tx: w.hash };
check("nothing left owed to the seller", await owedTo(sellerAddr), 0n);
const status = await readView(buyer, clause, "status");
check("the escrow holds exactly what is escrowed or owed", BigInt(status.balance), BigInt(status.held) + BigInt(status.owed));
check("the jury contract holds nothing", await balance(jury), 0n);
console.log("\nstatus:", JSON.stringify(status));

const juryRelease = (await readView(buyer, jury, "status")).release;
fs.writeFileSync(`scenario-${network}.json`, JSON.stringify({
  network, escrow: clause, jury, jury_release: juryRelease, appeal_seconds: APPEAL, recorded_at: new Date().toISOString(),
  note: "Phases 1-2 (fund, deliver, dispute, convene the jury) ran in scenario.mjs; its process died during the appeal wait, before writing this file, and their transaction hashes were not kept. Every verdict here is read back from ruling_of on the jury contract (see ruling_source); phases 3-5 ran in resume_scenario.mjs and carry their hashes.",
  cases, status, log,
}, null, 2));
console.log(`\n${failures} failed checks`);
process.exit(failures ? 1 : 0);
