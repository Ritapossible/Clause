// Deploy Clause to a network and record it: the jury contract first, then
// the escrow, which names the jury it reads rulings from.
//
//   node deploy.mjs [studio|bradbury]
import fs from "node:fs";
import { clientFor, accountFor, deployFile, readBuild, readView } from "./lib.mjs";

const network = process.argv[2] || "studio";
const BOND_FLOOR = BigInt(process.env.BOND_FLOOR_MILLI ?? 10) * 10n ** 15n; // 0.01 GEN
// How long a ruling waits before the escrow applies it, so an appeal of the
// jury's transaction has its window. Remit measured finality at about 5
// minutes on Studio and used 40 on Bradbury.
const APPEAL = Number(process.env.APPEAL_SECONDS ?? (network === "studio" ? 300 : 2400));
const client = clientFor(network, "principal");

console.log(`network  ${network}\ndeployer ${accountFor("principal").address}`);
const jury = await deployFile(client, readBuild("clause_jury"), [], "deploy jury");
console.log(`jury     ${jury.address}  (${jury.hash})`);
const escrow = await deployFile(client, readBuild("clause"), [jury.address, BOND_FLOOR, APPEAL], "deploy escrow");
console.log(`escrow   ${escrow.address}  (${escrow.hash})`);
console.log("status  ", JSON.stringify(await readView(client, escrow.address, "status")));

const path = "deployments.json";
const all = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
all[network] = {
  clause: escrow.address, deploy_tx: escrow.hash,
  jury: jury.address, jury_deploy_tx: jury.hash,
  bond_floor: String(BOND_FLOOR), appeal_seconds: APPEAL, release: "clause/2", at: new Date().toISOString(),
};
fs.writeFileSync(path, JSON.stringify(all, null, 2));
console.log("recorded in deploy/deployments.json");
