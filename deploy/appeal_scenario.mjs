// An appeal of the jury, and the escrow paying anyway.
//
// Measured on Studio in Remit: after an appeal, the appealed contract was
// served as "Contract not deployed" at its non-final state, and a contract
// that read it to pay could not pay. Clause keeps the money in an escrow that
// reads the jury in one place only (apply_ruling). This script:
//
//   1. deploys a fresh jury and escrow (so the main deployment is untouched);
//   2. funds a deal, delivers matching work, disputes it, convenes the jury;
//   3. appeals the jury's ruling transaction at once;
//   4. reads the jury contract - recording whether it is still readable;
//   5. tries apply_ruling, recording what happens;
//   6. once the dispute's clock has run out, settle and withdraw on the
//      escrow must still move the GEN, whatever state the jury is in.
//
//   node appeal_scenario.mjs [studio]
import fs from "node:fs";
import { clientFor, accountFor, deployFile, readBuild, sendTx, readView, readUntil } from "./lib.mjs";

const network = process.argv[2] || "studio";
const APPEAL = 300;
const principal = clientFor(network, "principal");
const buyer = clientFor(network, "agent");
const seller = clientFor(network, "vendor");
const sellerAddr = accountFor("vendor").address;
const RAW = "https://raw.githubusercontent.com/Ritapossible/Clause/main/examples/";
const THREE = [RAW + "cities-three.json", "e5e61d7ab0adb4ba31a6326751d02107b4a2dc1e957912fe2d24177539fa1bfb"];
const GEN = (n) => BigInt(Math.round(n * 1000)) * 10n ** 15n;
const CITIES = { id: "cities", criterion: "A list of African cities for the travel page", test: "The response contains exactly 3 city names", amount: Number(GEN(0.05)) };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t0 = Date.now();
const at = () => Math.round((Date.now() - t0) / 1000);
const rpc = buyer.chain.rpcUrls.default.http[0];
const log = [];
const timeline = [];
let failures = 0;

function check(label, actual, expected) {
  const ok = String(actual) === String(expected);
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${label}: ${actual}${ok ? "" : `  (expected ${expected})`}`);
  log.push({ check: label, actual: String(actual), expected: String(expected), ok });
}
async function tx(client, address, fn, args, label, value = 0n) {
  const o = await sendTx(client, address, fn, args, label, value);
  log.push({ tx: label, hash: o.hash, consensus: o.consensus, leader: o.leader, at: at() });
  console.log(`  - [${at()}s] ${label}: ${o.applied ? "applied" : o.refused ? "refused" : o.consensus}`);
  return o;
}
const errText = (e) => String(e?.details ?? e?.shortMessage ?? e?.message ?? e).slice(0, 160);
async function balance(addr) {
  const res = await fetch(rpc, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [addr, "latest"] }) });
  return BigInt((await res.json()).result ?? "0x0");
}

console.log("1. A fresh jury and escrow");
const jury = (await deployFile(principal, readBuild("clause_jury"), [], "deploy jury")).address;
const escrow = (await deployFile(principal, readBuild("clause"), [jury, GEN(0.01), APPEAL], "deploy escrow")).address;
console.log(`  jury ${jury}\n  escrow ${escrow}`);
const deal = () => readView(buyer, escrow, "get_deal", [0]);
const juryHealth = async (label) => {
  const h = {
    status: await readView(buyer, jury, "status").then((s) => `ok ${JSON.stringify(s)}`).catch(errText),
    ruling: await readView(buyer, jury, "ruling_of", [escrow, 0, "cities"]).then((r) => `ok ${JSON.stringify(r)}`).catch(errText),
  };
  timeline.push({ at: at(), event: label, ...h });
  console.log(`  [${at()}s] jury ${label}: status ${h.status.slice(0, 70)} | ruling ${h.ruling.slice(0, 90)}`);
  return h;
};

console.log("\n2. A deal, a delivery, a dispute, a ruling");
await tx(buyer, escrow, "create_deal", [sellerAddr, JSON.stringify([CITIES]), 3600, 900, 1800, 60], "fund", GEN(0.05));
await readUntil(async () => Number((await readView(buyer, escrow, "status")).deals), (n) => n > 0, { seconds: 120 });
await tx(seller, escrow, "deliver", [0, THREE[0], THREE[1]], "deliver");
await readUntil(deal, (d) => !!d.delivery, { seconds: 120 });
await tx(buyer, escrow, "dispute", [0, "cities", "", ""], "dispute", GEN(0.01));
await readUntil(deal, (d) => d.lines[0].state === "disputed", { seconds: 120 });
const ruled = await tx(buyer, jury, "rule", [escrow, 0, "cities"], "rule");
const before = await juryHealth("after the ruling");

console.log("\n3. Appeal the ruling transaction at once");
let appeal = { attempted: false };
try {
  const bond = await principal.getMinAppealBond({ txId: ruled.hash }).catch((e) => { appeal.bond_error = errText(e); return 0n; });
  appeal.min_bond = String(bond);
  const hash = await principal.appealTransaction({ txId: ruled.hash, value: bond });
  appeal = { ...appeal, attempted: true, hash: String(hash ?? ""), at: at() };
  console.log(`  - [${at()}s] appeal submitted`);
} catch (e) {
  appeal.error = errText(e);
  console.log(`  - appeal could not be submitted: ${appeal.error}`);
}
check("appeal submitted", appeal.attempted, true);

console.log("\n4. The jury contract while the appeal runs");
await sleep(20000);
const during = await juryHealth("during the appeal");

console.log("\n5. The escrow tries to apply the ruling after its appeal window");
const d0 = await deal();
const toApply = Number(d0.now) < Number(d0.lines[0].dispute.opened_at) + APPEAL ? Number(d0.lines[0].dispute.opened_at) + APPEAL - Number(d0.now) + 20 : 0;
if (toApply > 0) await sleep(toApply * 1000);
const applied = await tx(buyer, escrow, "apply_ruling", [0, "cities"], "apply_ruling");
const afterApply = await juryHealth("at apply time");

console.log("\n6. The escrow's clock and its withdraw, whatever the jury's state");
const d1 = await deal();
if (d1.lines[0].state === "disputed") {
  const lapse = Number(d1.lines[0].dispute.rule_by) + APPEAL - Number(d1.now) + 10;
  if (lapse > 0) { console.log(`  waiting ${lapse}s for the dispute to lapse`); await sleep(lapse * 1000); }
  await tx(seller, escrow, "settle", [0], "settle");
}
const line = (await readUntil(deal, (d) => d.lines[0].state !== "disputed", { seconds: 300 })).value.lines[0];
check("the clause resolved on the escrow", line.state, "released");
console.log(`    resolved by ${line.lapsed ? "its deadline (no ruling applied)" : `the ruling (${line.verdict})`}`);
const owed = BigInt(await readView(buyer, escrow, "owed_to", [sellerAddr]));
const bal0 = await balance(sellerAddr);
const w = await tx(seller, escrow, "withdraw", [], "withdraw");
check("withdraw applied", w.applied, true);
const bal1 = (await readUntil(() => balance(sellerAddr), (b) => b > bal0, { seconds: 300, every: 10 })).value;
check("the seller's wallet received what the escrow owed it", bal1 - bal0, owed);
const finalHealth = await juryHealth("at the end");
const status = await readView(buyer, escrow, "status");
check("the escrow's books balance", BigInt(status.balance), BigInt(status.held) + BigInt(status.owed));

fs.writeFileSync(`appeal-${network}.json`, JSON.stringify({
  network, recorded_at: new Date().toISOString(), jury, escrow, appeal_seconds: APPEAL, rule_tx: ruled.hash, appeal,
  jury_health: { before, during, at_apply: afterApply, at_end: finalHealth },
  apply_ruling: applied.applied ? "applied" : applied.refused ? "refused" : applied.consensus,
  resolved: { state: line.state, lapsed: !!line.lapsed, verdict: line.verdict ?? null },
  withdraw: { owed: String(owed), received: String(bal1 - bal0) }, status, timeline, log,
}, null, 2));
console.log(`\n${failures} failed checks`);
process.exit(failures ? 1 : 0);
