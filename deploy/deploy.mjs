// Deploy Clause to a network and record it.
//
//   node deploy.mjs [studio|bradbury]
import fs from "node:fs";
import { clientFor, accountFor, deployFile, readBuild, readView } from "./lib.mjs";

const network = process.argv[2] || "studio";
const BOND_FLOOR = BigInt(process.env.BOND_FLOOR_MILLI ?? 10) * 10n ** 15n; // 0.01 GEN
const client = clientFor(network, "principal");
const code = readBuild("clause");

console.log(`network  ${network}\ndeployer ${accountFor("principal").address}\ncode     ${code.length} bytes`);
const { address, hash } = await deployFile(client, code, [BOND_FLOOR], "deploy clause");
console.log(`clause   ${address}\ntx       ${hash}`);
console.log("status  ", JSON.stringify(await readView(client, address, "status")));

const path = "deployments.json";
const all = fs.existsSync(path) ? JSON.parse(fs.readFileSync(path, "utf8")) : {};
all[network] = { clause: address, deploy_tx: hash, bond_floor: String(BOND_FLOOR), at: new Date().toISOString() };
fs.writeFileSync(path, JSON.stringify(all, null, 2));
console.log("recorded in deploy/deployments.json");
